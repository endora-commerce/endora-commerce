import type { CheckoutPayer } from '@endora-commerce/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
  seedCartForStubCustomer,
} from '../../helpers/seed-commerce.js';
import { Cart, CartItem, CreditLimit, Organization, PaymentMethod } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TaxService } from '../../../../packages/modules/taxes/src/backend/services/tax-service.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { makeMember, releaseMembers, reparent } from '../returns/organization-fixtures.js';
import { ADMIN, makeAddress, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` US2 (FR-060 – FR-068, SC-001, SC-007) — a buyer places an order
 * its payer pays for. X is the stub customer's Organization; Y a fresh company linked to X.
 */
const X = TEST_ORGANIZATION_ID;
const CUSTOMER = { b2b_session: 'stub-customer-session' };

describe('related payers — placement with a payer (US2)', () => {
  let h: BackendServerHandle;
  let y: string;
  let yBilling: string;
  let linkId: string;
  let otherMethod: string;
  let creditMethod: string;
  const sql = <T = Record<string, unknown>>(statement: string, params: unknown[] = []) =>
    h.em().getConnection().execute(statement, params) as Promise<T[]>;

  async function setSetting(code: string, value: unknown): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: ADMIN,
      payload: { scope: 'all', value },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

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

  async function patchLink(body: Record<string, unknown>): Promise<void> {
    const res = await h.app.inject({ method: 'PATCH', url: `/api/v1/admin/related-payers/links/${linkId}`, cookies: ADMIN, payload: body });
    expect(res.statusCode, res.body).toBe(200);
  }

  const placeBody = (over: Record<string, unknown> = {}) => ({
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: yBilling,
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    payerOrganizationId: y,
    ...over,
  });

  const place = (over: Record<string, unknown> = {}, cookies: Record<string, string> = CUSTOMER) =>
    h.app.inject({ method: 'POST', url: '/api/v1/orders', cookies, payload: placeBody(over) });

  const preview = (over: Record<string, unknown> = {}) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies: CUSTOMER,
      payload: {
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        billingAddressId: yBilling,
        payerOrganizationId: y,
        ...over,
      },
    });

  async function ordersOfX(): Promise<number> {
    const [row] = await sql<{ n: number }>(`select count(*)::int as n from orders where organization_id = ?`, [X]);
    return row!.n;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    y = await makeOrganization(h.em(), 'Payer Y');
    yBilling = await makeAddress(h.em(), y, 'billing');
    await setSetting('related_payers.enabled', true);
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${X}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: y },
    });
    expect(link.statusCode, link.body).toBe(201);
    linkId = link.json().data.id;
    await withSystemScope('test seed: payment methods', async () => {
      const em = h.em().fork();
      otherMethod = randomUUID();
      creditMethod = randomUUID();
      em.create(PaymentMethod, {
        id: otherMethod,
        code: `rp-other-${otherMethod.slice(0, 8)}`,
        name: { 'en-US': 'Other transfer' },
        kind: 'bank_transfer',
        adapter: 'bank_transfer',
        statusOnPending: 'new',
        statusOnSuccess: 'paid',
        statusOnFailure: 'cancelled',
      } as never);
      em.create(PaymentMethod, {
        id: creditMethod,
        code: `rp-credit-${creditMethod.slice(0, 8)}`,
        name: { 'en-US': 'Credit limit' },
        kind: 'credit_limit',
        adapter: 'credit_limit',
        statusOnPending: 'new',
        statusOnSuccess: 'paid',
        statusOnFailure: 'cancelled',
      } as never);
      await em.flush();
    });
  });

  afterAll(async () => {
    releaseMembers();
    await allowPayments(X, []).catch(() => undefined);
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await seedCartForStubCustomer(h.em());
  });

  it('US2-1: places with Y as payer — X keeps the order, the billing snapshot and payer are Y, terms buyer', async () => {
    const res = await place();
    expect(res.statusCode, res.body).toBe(201);
    const order = res.json().data;
    expect(order.organizationId).toBe(X);
    expect(order.payer).toMatchObject({ organizationId: y, terms: 'buyer' });
    const [row] = await sql<Record<string, unknown>>(
      `select organization_id, payer_organization_id, payer_link_id, payer_terms, payer_snapshot, billing_address, delivery_address from orders where id = ?`,
      [order.id],
    );
    const ySnapshot = (await h.em().fork().findOneOrFail(Organization, { id: y })) as { name: string; taxId: string };
    expect(row).toMatchObject({ organization_id: X, payer_organization_id: y, payer_link_id: linkId, payer_terms: 'buyer' });
    expect(row!.payer_snapshot).toMatchObject({ organizationId: y, name: ySnapshot.name, taxId: ySnapshot.taxId, vatStatus: 'vat_payer' });
    expect(row!.billing_address).toMatchObject({ companyName: ySnapshot.name, taxId: ySnapshot.taxId, street: 'S182-STREET 1' });
    // FR-066 — delivery stays the buyer's.
    expect((row!.delivery_address as { recipientName: string }).recipientName).toBeTruthy();
  });

  it('FR-062: a payer together with a billing override is refused, writing nothing', async () => {
    const before = await ordersOfX();
    const res = await place({ billingCompanyName: 'Somebody else' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.body).toContain('payer_billing_override_conflict');
    expect(await ordersOfX()).toBe(before);
  });

  it('FR-063: only an allowed live billing address of the payer — X\'s own or another\'s is refused', async () => {
    const before = await ordersOfX();
    const xBilling = await place({ billingAddressId: SEED_ADDRESS_BILLING_ID });
    expect([xBilling.statusCode, xBilling.json().error.code]).toEqual([403, 'ADDRESS_NOT_OWNED']);
    const other = await makeOrganization(h.em(), 'Other Z');
    const zBilling = await makeAddress(h.em(), other, 'billing');
    const foreign = await place({ billingAddressId: zBilling });
    expect([foreign.statusCode, foreign.json().error.code]).toEqual([403, 'ADDRESS_NOT_OWNED']);
    // The delivery address stays the buyer's: Y's address is not one X may ship to.
    const yDelivery = await place({ deliveryAddressId: yBilling });
    expect([yDelivery.statusCode, yDelivery.json().error.code]).toEqual([403, 'ADDRESS_NOT_OWNED']);
    expect(await ordersOfX()).toBe(before);
  });

  it('SC-001: tax follows Y\'s VAT status and billing country, and preview equals placement', async () => {
    // A default 23 % rule, so a VAT payer is charged and an exempt payer is not.
    const taxes0 = new TaxService(h.em);
    await taxes0.upsertByCode({ code: 'rp182_default', name: 'RP182 default 23%', rate: 0.23, isDefault: true });
    const cases: Array<{ vatStatus: string; country: string }> = [
      { vatStatus: 'vat_payer', country: 'PL' },
      { vatStatus: 'vat_exempt', country: 'PL' },
      { vatStatus: 'vat_payer', country: 'DE' },
      { vatStatus: 'vat_exempt', country: 'DE' },
    ];
    const taxes: Record<string, number> = {};
    for (const c of cases) {
      await sql(`update organizations set vat_status = ? where id = ?`, [c.vatStatus, y]);
      await sql(`update addresses set country = ? where id = ?`, [c.country, yBilling]);
      await seedCartForStubCustomer(h.em());
      const p = await preview();
      expect(p.statusCode, p.body).toBe(200);
      const placed = await place();
      expect(placed.statusCode, placed.body).toBe(201);
      const order = placed.json().data;
      expect({ tax: order.taxTotal, total: order.total }, `${c.vatStatus}/${c.country}`).toEqual({
        tax: p.json().data.taxTotal,
        total: p.json().data.total,
      });
      taxes[`${c.vatStatus}/${c.country}`] = order.taxTotal;
    }
    await sql(`update organizations set vat_status = 'vat_payer' where id = ?`, [y]);
    await sql(`update addresses set country = 'PL' where id = ?`, [yBilling]);
    await sql(`delete from taxes where code = 'rp182_default'`);
    expect(taxes['vat_payer/PL']).toBeGreaterThan(0);
    expect(taxes['vat_exempt/PL']).toBe(0);
  });

  it('FR-066 / RP-9: payment methods are Y\'s allow-list; X\'s list does not narrow it', async () => {
    await allowPayments(y, [SEED_PAYMENT_METHOD_ID]);
    await allowPayments(X, [otherMethod]);
    try {
      const before = await ordersOfX();
      const refused = await place({ paymentMethodId: otherMethod });
      expect([refused.statusCode, refused.json().error.code]).toEqual([400, 'ORDER_PAYMENT_METHOD_UNAVAILABLE']);
      expect(await ordersOfX()).toBe(before);
      // A method X itself may not use is accepted, because Y may.
      const accepted = await place({ paymentMethodId: SEED_PAYMENT_METHOD_ID });
      expect(accepted.statusCode, accepted.body).toBe(201);
    } finally {
      await allowPayments(y, []);
      await allowPayments(X, []);
    }
  });

  it('FR-065: credit is reserved on Y, never on X; an insufficient Y credit refuses like Y\'s own', async () => {
    await withSystemScope('test seed: credit', async () => {
      const em = h.em().fork();
      await em.nativeDelete(CreditLimit, { organizationId: y });
      em.create(CreditLimit, { organizationId: y, grantedAmount: '100000.00', currency: 'PLN' } as never);
      await em.flush();
    });
    const placed = await place({ paymentMethodId: creditMethod });
    expect(placed.statusCode, placed.body).toBe(201);
    const reservations = await sql<{ organization_id: string }>(
      `select l.organization_id from credit_limit_reservations r join credit_limits l on l.id = r.credit_limit_id where r.order_id = ?`,
      [placed.json().data.id],
    );
    expect(reservations.map((r) => r.organization_id)).toEqual([y]);

    await sql(`update credit_limits set granted_amount = 0.01 where organization_id = ?`, [y]);
    await seedCartForStubCustomer(h.em());
    const before = await ordersOfX();
    const refused = await place({ paymentMethodId: creditMethod });
    expect([refused.statusCode, refused.json().error.code]).toEqual([409, 'LIMIT_INSUFFICIENT']);
    expect(await ordersOfX()).toBe(before);
  });

  it('FR-065: credit is reserved on Y\'s inherited credit owner (Y\'s parent, shared_pool)', async () => {
    const parent = await makeOrganization(h.em(), 'Payer parent P');
    const child = await makeOrganization(h.em(), 'Payer branch Y2');
    const childBilling = await makeAddress(h.em(), child, 'billing');
    await reparent(h, child, parent);
    await sql(`update organizations set credit_inheritance_mode = 'shared_pool' where id = ?`, [parent]);
    await withSystemScope('test seed: parent credit', async () => {
      const em = h.em().fork();
      em.create(CreditLimit, { organizationId: parent, grantedAmount: '100000.00', currency: 'PLN' } as never);
      await em.flush();
    });
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${X}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: child },
    });
    expect(link.statusCode, link.body).toBe(201);
    const placed = await place({ payerOrganizationId: child, billingAddressId: childBilling, paymentMethodId: creditMethod });
    expect(placed.statusCode, placed.body).toBe(201);
    const owners = await sql<{ organization_id: string }>(
      `select l.organization_id from credit_limit_reservations r join credit_limits l on l.id = r.credit_limit_id where r.order_id = ?`,
      [placed.json().data.id],
    );
    expect(owners.map((r) => r.organization_id)).toEqual([parent]);
  });

  describe('FR-068: every refusal writes, reserves and emits nothing', () => {
    async function expectRefused(act: () => Promise<{ statusCode: number; json(): { error: { code: string } } }>, code: string) {
      await seedCartForStubCustomer(h.em());
      const before = await ordersOfX();
      const res = await act();
      expect([res.statusCode, res.json().error.code]).toEqual([code === 'MODULE_DISABLED' ? 503 : 422, code]);
      expect(await ordersOfX()).toBe(before);
    }

    it('the capability off on the channel', async () => {
      await setSetting('related_payers.enabled', false);
      try {
        await expectRefused(() => place(), 'RELATED_PAYER_NOT_USABLE');
        await expectRefused(() => preview(), 'RELATED_PAYER_NOT_USABLE');
      } finally {
        await setSetting('related_payers.enabled', true);
      }
    });

    it('a person without related_payers.order_with_payer', async () => {
      const member = await makeMember(h.em(), X, 'member', { label: 'RP-NoPayer' });
      // The member's own basket, so the refusal is the payer's and not an empty cart.
      const em = h.em().fork();
      const cart = em.create(Cart, {
        customerAccountId: member.id,
        organizationId: X,
        status: 'active',
        salesChannelId: await systemDefaultSalesChannelId(em),
      } as never);
      await em.persistAndFlush(cart);
      em.create(CartItem, {
        cartId: (cart as { id: string }).id,
        productId: SEED_PRODUCT_101_ID,
        quantity: 1,
        unitPrice: '19.99',
        currency: 'PLN',
      } as never);
      await em.flush();
      await expectRefused(() => place({}, { b2b_session: member.cookie }), 'RELATED_PAYER_NOT_USABLE');
    });

    it('the link inactive, revoked-equivalent window passed, or the payer blocked', async () => {
      await patchLink({ state: 'inactive' });
      await expectRefused(() => place(), 'RELATED_PAYER_NOT_USABLE');
      await patchLink({ state: 'active' });

      await patchLink({ validTo: new Date(Date.now() - 60_000).toISOString() });
      await expectRefused(() => place(), 'RELATED_PAYER_NOT_USABLE');
      await patchLink({ validTo: null });

      await sql(`update organizations set status = 'blocked' where id = ?`, [y]);
      try {
        await expectRefused(() => place(), 'RELATED_PAYER_NOT_USABLE');
      } finally {
        await sql(`update organizations set status = 'active' where id = ?`, [y]);
      }
    });

    it('a payer X has no link to', async () => {
      const stranger = await makeOrganization(h.em(), 'Stranger');
      const strangerBilling = await makeAddress(h.em(), stranger, 'billing');
      await expectRefused(() => place({ payerOrganizationId: stranger, billingAddressId: strangerBilling }), 'RELATED_PAYER_NOT_USABLE');
    });

    it('the module switched off', async () => {
      await withModuleOff('related_payers', 'deactivated', async () => {
        await expectRefused(() => place(), 'MODULE_DISABLED');
        // SC-007 — an order without a payer is unaffected.
        const plain = await place({ payerOrganizationId: undefined, billingAddressId: SEED_ADDRESS_BILLING_ID });
        expect(plain.statusCode, plain.body).toBe(201);
        expect(plain.json().data.payer).toBeNull();
      });
    });
  });

  it('SC-007: without a payer, placement is unchanged and payer is null', async () => {
    const res = await place({ payerOrganizationId: undefined, billingAddressId: SEED_ADDRESS_BILLING_ID });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().data.payer).toBeNull();
    const [row] = await sql(`select payer_organization_id, payer_snapshot from orders where id = ?`, [res.json().data.id]);
    expect(row).toEqual({ payer_organization_id: null, payer_snapshot: null });
  });

  it('the checkout payer list names Y with its billing address and allow-list', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/checkout/payers', cookies: CUSTOMER });
    expect(res.statusCode, res.body).toBe(200);
    // Find Y by id: other files add payers to the same stub Organization in parallel.
    const payer = (res.json().data as CheckoutPayer[]).find((p) => p.payerOrganizationId === y)!;
    expect(payer).toMatchObject({ payerOrganizationId: y, commercialTerms: 'buyer', paymentMethodIds: null });
    // RP-16 (c) — Y's available credit, as `GET /api/v1/me/credit-limit` would answer Y: its
    // grant less its active reservations (seeded by the FR-065 case above).
    const [credit] = await sql<{ granted_amount: string; reserved: string | null }>(
      `select l.granted_amount, (select sum(r.amount) from credit_limit_reservations r where r.credit_limit_id = l.id and r.status = 'active') as reserved
         from credit_limits l where l.organization_id = ?`,
      [y],
    );
    expect(payer.creditAvailable).toBe(Number(credit!.granted_amount) - Number(credit!.reserved ?? 0));
    expect(payer.billingAddresses.map((a: { id: string }) => a.id)).toEqual([yBilling]);
  });
});
