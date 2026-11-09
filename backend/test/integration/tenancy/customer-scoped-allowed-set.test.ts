import { randomUUID } from 'node:crypto';
import type { AddressServicePort } from '@endora-commerce/contracts';
import { Cart } from '../../helpers/package-entities.js';
import { AdminRole, AdminUser, Organization, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';





import { CustomerAccount } from '../../helpers/package-entities.js';

import { ADMIN_COOKIES } from '../../helpers/test-actors.js';


/**
 * `@CustomerScoped` entities under an `allowed-set` context.
 *
 * `customerFilterCond` returns **no predicate at all** for `allowed-set` — the
 * mode an assignment-scoped administrator resolves to — because a
 * customer-account predicate cannot express an organization restriction
 * (`filters.ts`, citing research §R4/R7). So for a `sales_representative` every
 * `@CustomerScoped` entity behaves exactly as if it were `@GlobalEntity`, and
 * the tenant boundary on any admin surface over one is whatever that surface
 * does for itself.
 *
 * These two surfaces do nothing, and both have a determinate answer that needs
 * no reclassification and no change to the filter:
 *
 *  - **carts** — `Cart` *does* carry `organizationId`, so the exemption's
 *    stated premise ("customer-scoped entities carry no org column") is simply
 *    false for it and the constraint is expressible with `orgConstraintFor()`,
 *    the helper `derived-scope.ts` exists to provide.
 *  - **customer addresses** — the admin card reads the customer's Organization
 *    book (`specs/173-b2c-address-book-merge/` OD-1) through the customer's
 *    `@OrgScoped` account, so a customer outside the scope reads as absent and
 *    discloses no book. The personal book this used to seed through
 *    `CustomerAddress` is retired, and its admin write with it (#798).
 *
 * Every assertion runs in both directions: a guard that refuses everybody
 * passes the out-of-scope half on its own. The writes assert the **stored
 * state**, not only the status code.
 */
describe('@CustomerScoped surfaces honour the sales-rep assignment scope', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  let assignedOrgId: string;
  let foreignOrgId: string;
  const OTHER_REP_ID = randomUUID();

  const carts: Record<string, string> = {};
  const customers: Record<string, string> = {};
  const addresses: Record<string, string> = {};
  let addressPort: AddressServicePort;

  const stamp = Date.now();

  const newOrganization = (em: EntityManager, name: string, suffix: string): Organization =>
    em.create(Organization, {
      name,
      taxId: `PLCUST${suffix}${String(stamp).slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Klienta 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    addressPort = (h.container.cradle as unknown as { addressServicePort: AddressServicePort })
      .addressServicePort;

    // The admin scope resolution keys on this exact role code, so the fixture
    // cannot use a code of its own. Another file in the run may have created it
    // already with a narrower grant set — widen that one rather than creating a
    // second row the unique index would refuse.
    const grants = ['carts:read', 'carts:reject', 'customers:read', 'customers:manage'];
    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: grants,
      });
    } else {
      role.permissions = Array.from(new Set([...role.permissions, ...grants]));
    }
    await em.persistAndFlush(role);

    const rep = em.create(AdminUser, {
      email: `customer-scope-rep-${stamp}@audit.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Customer',
      lastName: 'Scope',
    });
    const assigned = newOrganization(em, 'Customer scope assigned org', 'A');
    const foreign = newOrganization(em, 'Customer scope foreign org', 'F');
    await em.persistAndFlush([rep, assigned, foreign]);
    assignedOrgId = assigned.id;
    foreignOrgId = foreign.id;

    await em.persistAndFlush([
      em.create(OrganizationSalesRepAssignment, {
        organizationId: assignedOrgId,
        adminUserId: rep.id,
      }),
      // #305 — the foreign organization is another representative's: an
      // unassigned organization is in every representative's reach.
      em.create(OrganizationSalesRepAssignment, { organizationId: foreignOrgId, adminUserId: OTHER_REP_ID }),
    ]);

    for (const key of ['own', 'foreign'] as const) {
      const organizationId = key === 'own' ? assignedOrgId : foreignOrgId;
      const account = em.create(CustomerAccount, {
        organizationId,
        email: `customer-scope-${key}-${stamp}@audit.local`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Scope',
        lastName: key,
      });
      await em.persistAndFlush(account);
      customers[key] = account.id;

      // The Organization book — the one book a customer has — written through
      // `addresses`' published service, as `organizations` writes it.
      const address = await addressPort.createAddress(organizationId, {
        kind: 'delivery',
        recipientName: `Recipient ${key} ${stamp}`,
        street: `ul. Firmowa ${stamp}`,
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
        phone: `+48-${key}-${stamp}`,
      });
      addresses[key] = address.id;

      // One cart per read assertion and one per write, so the reject test
      // cannot disturb what the list and detail tests read.
      for (const purpose of ['read', 'reject'] as const) {
        const cart = em.create(Cart, {
          customerAccountId: account.id,
          organizationId,
          // No sales channel: this fixture asserts the tenant boundary, and the
          // column is nullable — naming a channel id that may not exist is how a
          // fixture starts substituting for a row it never created.
          status: 'active',
        });
        await em.persistAndFlush(cart);
        carts[`${key}-${purpose}`] = cart.id;
      }
    }

    repCookie = `stub-customer-scope-rep-${stamp}`;
    ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };
  });

  afterAll(async () => {
    await h.em().getConnection().execute('delete from organization_sales_rep_assignments where admin_user_id = ?', [OTHER_REP_ID]);
    delete ADMIN_COOKIES[repCookie];
    await teardownBackendServer(h);
  });

  const cartStatus = async (id: string): Promise<string | null> =>
    (await h.em().findOne(Cart, { id }))?.status ?? null;

  const addressCount = async (organizationId: string): Promise<number> =>
    (await addressPort.list(organizationId)).length;

  const organizationRecipients = (body: string): string[] =>
    (JSON.parse(body) as { data: { organization: Array<{ recipientName: string }> } }).data.organization.map(
      (a) => a.recipientName,
    );

  it('lists only carts of organizations inside the scope', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/carts?pageSize=200',
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((c) => c.id);
    expect(ids).toContain(carts['own-read']);
    expect(ids).not.toContain(carts['foreign-read']);
  });

  it('refuses the cart detail and audit feed of an organization outside the scope', async () => {
    for (const suffix of ['', '/audit']) {
      const refused = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/carts/${carts['foreign-read']}${suffix}`,
        cookies: { b2b_session: repCookie },
      });
      expect(refused.statusCode).toBe(404);

      const served = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/carts/${carts['own-read']}${suffix}`,
        cookies: { b2b_session: repCookie },
      });
      expect(served.statusCode).toBe(200);
    }
  });

  it('refuses rejecting a cart outside the scope, writing nothing', async () => {
    const refused = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/carts/${carts['foreign-reject']}/reject`,
      payload: { reason: 'audit probe' },
      cookies: { b2b_session: repCookie },
    });
    expect(refused.statusCode).toBe(404);
    expect(await cartStatus(carts['foreign-reject']!)).toBe('active');

    const accepted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/carts/${carts['own-reject']}/reject`,
      payload: { reason: 'audit probe' },
      cookies: { b2b_session: repCookie },
    });
    expect(accepted.statusCode).toBe(200);
    expect(await cartStatus(carts['own-reject']!)).toBe('rejected');
  });

  it('discloses no address book of a customer outside the scope', async () => {
    const refused = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers/${customers['foreign']}/addresses`,
      cookies: { b2b_session: repCookie },
    });
    // The existence guard (#794) reads the customer through its `@OrgScoped`
    // account, so a customer outside the scope answers as an absent one does.
    expect(refused.statusCode).toBe(404);
    expect((refused.json() as { error: { code: string } }).error.code).toBe('CUSTOMER_NOT_FOUND');
    expect(refused.body).not.toContain(`Recipient foreign ${stamp}`);
    expect(refused.body).not.toContain(addresses['foreign']!);

    const served = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers/${customers['own']}/addresses`,
      cookies: { b2b_session: repCookie },
    });
    expect(served.statusCode).toBe(200);
    expect(organizationRecipients(served.body)).toContain(`Recipient own ${stamp}`);
  });

  it('writes nothing through the retired address write, inside the scope or outside it', async () => {
    const before = {
      own: await addressCount(assignedOrgId),
      foreign: await addressCount(foreignOrgId),
    };
    const payload = {
      kind: 'delivery',
      recipientName: `Injected ${stamp}`,
      street: 'ul. Wstrzyknięta 1',
      city: 'Warszawa',
      postalCode: '00-100',
      country: 'PL',
    };

    const foreign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customers['foreign']}/addresses`,
      payload,
      cookies: { b2b_session: repCookie },
    });
    expect(foreign.statusCode).toBeGreaterThanOrEqual(400);
    expect(foreign.statusCode).toBeLessThan(500);

    const own = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customers['own']}/addresses`,
      payload,
      cookies: { b2b_session: repCookie },
    });
    expect(own.statusCode).toBe(410);
    expect((own.json() as { error: { code: string } }).error.code).toBe('CUSTOMER_ADDRESS_BOOK_RETIRED');

    expect({
      own: await addressCount(assignedOrgId),
      foreign: await addressCount(foreignOrgId),
    }).toEqual(before);
  });

  it('leaves a platform administrator reaching both organizations', async () => {
    for (const key of ['own', 'foreign'] as const) {
      const cart = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/carts/${carts[`${key}-read`]}`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(cart.statusCode).toBe(200);

      const addr = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/customers/${customers[key]}/addresses`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(addr.statusCode).toBe(200);
      expect(organizationRecipients(addr.body)).toContain(`Recipient ${key} ${stamp}`);
    }
  });
});
