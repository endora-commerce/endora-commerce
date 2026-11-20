import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressReadPort, OrganizationRestrictionPort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
  seedCartForStubCustomer,
} from '../../helpers/seed-commerce.js';
import { Organization, PaymentMethod } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { ADMIN, makeAddress, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` T027 (FR-063, FR-066, Principle XI) — **the payment-method
 * allow-list read for the payer must not fail open.**
 *
 * The allow-list rows are `@OrgScoped`. Read for Y while the ambient tenant is the buyer X,
 * they come back empty, and an empty allow-list means "unrestricted" — so a placement that
 * forgot the system scope would accept any method. The first case proves that premise on
 * the real port (the "seam removed" half: the same read without the scope answers no
 * restriction); the second proves placement does not fall into it. The third: Y's billing
 * address does not resolve through the address port under X's context, only through the
 * policy port.
 */
const X = TEST_ORGANIZATION_ID;
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const asBuyerX = <T>(fn: () => Promise<T>) =>
  runWithTenantContext({ mode: 'single-org', organizationId: X, actor: { kind: 'customer', id: TEST_CUSTOMER_ID } }, fn);

describe('related payers — the payer reads do not fail open', () => {
  let h: BackendServerHandle;
  let y: string;
  let yBilling: string;
  let methodB: string;
  const A = SEED_PAYMENT_METHOD_ID;

  async function allowPayments(organizationId: string, paymentMethodIds: string[]): Promise<void> {
    await withSystemScope('test seed: allow-list', async () => {
      const org = await h.em().fork().findOneOrFail(Organization, { id: organizationId });
      await h.organizations.restrictionService.replaceAllowLists(organizationId, {
        expectedVersion: (org as { version: number }).version,
        paymentMethodIds,
        deliveryMethodIds: [],
        warehouseIds: [],
      });
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    y = await makeOrganization(h.em(), 'Payer Y');
    yBilling = await makeAddress(h.em(), y, 'billing');
    const setting = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.enabled/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: true },
    });
    expect(setting.statusCode, setting.body).toBe(200);
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${X}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: y },
    });
    expect(link.statusCode, link.body).toBe(201);
    methodB = randomUUID();
    await withSystemScope('test seed: method B', async () => {
      const em = h.em().fork();
      em.create(PaymentMethod, {
        id: methodB,
        code: `rp-b-${methodB.slice(0, 8)}`,
        name: { 'en-US': 'Method B' },
        kind: 'bank_transfer',
        adapter: 'bank_transfer',
        statusOnPending: 'new',
        statusOnSuccess: 'paid',
        statusOnFailure: 'cancelled',
      } as never);
      await em.flush();
    });
    // Y allows only A; X allows A and B.
    await allowPayments(y, [A]);
    await allowPayments(X, [A, methodB]);
  });

  afterAll(async () => {
    await allowPayments(X, []).catch(() => undefined);
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await seedCartForStubCustomer(h.em());
  });

  it('premise: Y\'s allow-list read under X\'s context answers "unrestricted" — fail-open without the system scope', async () => {
    const restriction = h.container.resolve<OrganizationRestrictionPort>('organizationRestrictionPort');
    const underX = await asBuyerX(() => restriction.allowedIdsFor(y, 'paymentMethodIds'));
    const underSystem = await withSystemScope('test: the payer allow-list', () => restriction.allowedIdsFor(y, 'paymentMethodIds'));
    expect(underSystem).toEqual([A]);
    // Empty or null both mean "no restriction" to the gate.
    expect(underX === null || underX.length === 0).toBe(true);
  });

  it('placement with payer Y and method B (allowed to X, not to Y) is refused', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: CUSTOMER,
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: yBilling,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: methodB,
        payerOrganizationId: y,
      },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error.code).toBe('ORDER_PAYMENT_METHOD_UNAVAILABLE');
    // The preview refuses it the same way.
    const preview = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies: CUSTOMER,
      payload: { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: methodB, billingAddressId: yBilling, payerOrganizationId: y },
    });
    expect([preview.statusCode, preview.json().error.code]).toEqual([400, 'ORDER_PAYMENT_METHOD_UNAVAILABLE']);
    // And the payer's catalogue does not offer it.
    const catalogue = await h.app.inject({ method: 'GET', url: `/api/v1/payment-methods?payerOrganizationId=${y}`, cookies: CUSTOMER });
    expect(catalogue.statusCode, catalogue.body).toBe(200);
    const ids = (catalogue.json().data as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toContain(A);
    expect(ids).not.toContain(methodB);
  });

  it('Y\'s billing address does not resolve through the address port under X\'s context, only through the policy port', async () => {
    const addresses = h.container.resolve<AddressReadPort>('addressReadPort');
    expect(await asBuyerX(() => addresses.findById(y, yBilling, { liveOnly: true }))).toBeNull();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/checkout/payers', cookies: CUSTOMER });
    expect(res.statusCode, res.body).toBe(200);
    const payer = (res.json().data as Array<{ payerOrganizationId: string; billingAddresses: Array<{ id: string }>; paymentMethodIds: string[] | null }>).find(
      (p) => p.payerOrganizationId === y,
    );
    expect(payer?.billingAddresses.map((a) => a.id)).toEqual([yBilling]);
    expect(payer?.paymentMethodIds).toEqual([A]);
  });
});
