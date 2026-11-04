import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  OrganizationPermissionPort,
  OrganizationPermissionSubject,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

/**
 * A member's cart answers judge their permissions with the role their session
 * already carries (`specs/170-organization-roles/` FR-080, SC-004; research
 * R-15; found by WP-13's SC-004 run, T113).
 *
 * The auth hook stamps the member's `organizationRoleId` on the actor out of
 * the account read it makes anyway, so a permission check on the cart path
 * needs no read of its own. A subject handed to the port **without** it makes
 * the port fall back to reading the account (`resolveAccountRoleId` — the
 * account and its MFA enrolments, two queries per check). The cart answer's
 * approval policy (`carts.order_without_approval`, the primary call to action)
 * and the routes' `carts.create` guard are both on every cart read and every
 * add, so each such fallback is a read per request SC-004 measures.
 *
 * The member here signs in through the real login, so the actor is the one a
 * production request carries.
 */

const PASSWORD = 'cart-permission-reads-1234!';

function sessionCookieOf(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie)
    ? setCookie.find((c) => c.includes('b2b_session='))
    : setCookie;
  return /b2b_session=([^;]+)/.exec(header ?? '')?.[1] ?? '';
}

describe("carts — a member's cart answers judge the session's role, with no read of their own (FR-080)", () => {
  let h: BackendServerHandle;
  let session = '';
  let roleId = '';
  /** Every subject the permission port was asked about while `recording`, with the code. */
  const asked: Array<{ method: string; code: string; subject: OrganizationPermissionSubject }> = [];
  let recording = false;
  /** The port's account reads (`resolveAccountRoleId`, two queries each) while `recording`. */
  let accountReads = 0;

  const inject = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({
      method,
      url,
      cookies: { b2b_session: session },
      ...(payload ? { payload } : {}),
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const register = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        organization: {
          name: 'Cart Permission Reads Sp. z o.o.',
          taxId: 'PL1700000171',
          registeredAddress: {
            street: 'ul. Odczytu 1',
            city: 'Warszawa',
            postalCode: '00-171',
            country: 'PL',
          },
        },
        firstUser: {
          email: 'cart-permission-reads@example.com',
          password: PASSWORD,
          firstName: 'Cart',
          lastName: 'Reads',
        },
        acceptedTermsVersion: '1.0.0',
      },
    });
    expect(register.statusCode, register.body).toBe(201);
    const { token } = (
      await h.app.inject({ method: 'GET', url: '/api/v1/_test/latest-verification-token' })
    ).json() as {
      token: string;
    };
    const verify = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/email-verification/verify',
      payload: { token },
    });
    expect(verify.statusCode, verify.body).toBe(200);
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: 'cart-permission-reads@example.com', password: PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
    session = sessionCookieOf(login.headers['set-cookie']);

    const [account] = await h
      .em()
      .getConnection()
      .execute<Array<{ organization_role_id: string }>>(
        `select "organization_role_id" from "customer_accounts" where "email" = ?`,
        ['cart-permission-reads@example.com'],
      );
    roleId = account!.organization_role_id;

    const port = (
      h.container.cradle as unknown as { organizationPermissionPort: OrganizationPermissionPort }
    ).organizationPermissionPort;
    const record =
      <M extends 'can' | 'assert'>(method: M) =>
      (original: OrganizationPermissionPort[M]) =>
        (async (subject: OrganizationPermissionSubject, code: string, ...rest: unknown[]) => {
          if (recording) asked.push({ method, code, subject });
          return (original as (...args: unknown[]) => Promise<unknown>).call(
            port,
            subject,
            code,
            ...rest,
          );
        }) as OrganizationPermissionPort[M];
    port.can = record('can')(port.can);
    port.assert = record('assert')(port.assert);
    // The fallback itself — the account and its MFA enrolments read for a
    // subject that names no role — counted where it happens.
    const deps = (
      port as unknown as {
        deps: {
          resolveAccountRoleId: (subject: OrganizationPermissionSubject) => Promise<string | null>;
        };
      }
    ).deps;
    const resolveAccountRoleId = deps.resolveAccountRoleId;
    deps.resolveAccountRoleId = (subject) => {
      if (recording) accountReads += 1;
      return resolveAccountRoleId(subject);
    };
  }, 120_000);

  afterAll(async () => {
    if (h) await teardownBackendServer(h);
  });

  const judged = async (
    call: () => Promise<{ statusCode: number; body: string }>,
    status: number,
  ) => {
    asked.length = 0;
    accountReads = 0;
    recording = true;
    const res = await call();
    recording = false;
    expect(res.statusCode, res.body).toBe(status);
    return asked.map(({ method, code, subject }) => ({
      method,
      code,
      organizationRoleId: subject.organizationRoleId,
    }));
  };

  it('POST /api/v1/cart/items — the carts.create guard and the approval policy name the role', async () => {
    const calls = await judged(
      () => inject('POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 }),
      200,
    );
    expect(calls.map((c) => c.code)).toEqual(
      expect.arrayContaining(['carts.create', 'carts.order_without_approval']),
    );
    expect(calls.filter((c) => c.organizationRoleId !== roleId)).toEqual([]);
    expect(accountReads).toBe(0);
  });

  it('GET /api/v1/cart — the approval policy names the role', async () => {
    const calls = await judged(() => inject('GET', '/api/v1/cart'), 200);
    expect(calls.map((c) => c.code)).toContain('carts.order_without_approval');
    expect(calls.filter((c) => c.organizationRoleId !== roleId)).toEqual([]);
    expect(accountReads).toBe(0);
  });

  // `orders` asks `carts` (`CartPlacementApplyPort.awaitsApproval`) whether the
  // placer's own basket still awaits approval; the placer's role is the actor's.
  it('POST /api/v1/orders — the approval rule names the role, and no account is read for it', async () => {
    const address = await inject('POST', '/api/v1/organizations/mine/addresses', {
      kind: 'delivery',
      recipientName: 'Cart Reads',
      street: 'ul. Odczytu 3',
      city: 'Warszawa',
      postalCode: '00-171',
      country: 'PL',
      isDefault: true,
    });
    expect(address.statusCode, address.body).toBe(201);
    const addressId = (address.json() as { data: { id: string } }).data.id;
    const add = await inject('POST', '/api/v1/cart/items', {
      productId: SEED_PRODUCT_101_ID,
      quantity: 1,
    });
    expect(add.statusCode, add.body).toBe(200);

    const calls = await judged(
      () =>
        inject('POST', '/api/v1/orders', {
          deliveryAddressId: addressId,
          billingAddressId: addressId,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        }),
      201,
    );
    expect(calls.map((c) => c.code)).toContain('carts.order_without_approval');
    expect(calls.filter((c) => c.organizationRoleId !== roleId)).toEqual([]);
    expect(accountReads).toBe(0);
  });
});
