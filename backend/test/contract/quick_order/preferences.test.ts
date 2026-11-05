import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  Address,
  CustomerAddress,
  Organization,
  PaymentMethod,
} from '../../helpers/package-entities.js';

/**
 * Feature 039 (US2) — default ordering preferences: role-scoped upsert,
 * resolved-with-eligibility, and audit.
 */

const COOKIE = { b2b_session: 'stub-customer-session' };

describe('Quick-order default preferences', () => {
  let h: BackendServerHandle;
  let paymentId: string;
  let ownAddressId: string;
  let foreignAddressId: string;
  let personalAddressId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const payment = await em.findOne(PaymentMethod, { status: 'active' });
    paymentId = payment!.id;
    const ownAddress = await em.findOne(Address, { organizationId: TEST_ORGANIZATION_ID });
    ownAddressId = ownAddress!.id;
    // Another organisation's address: a row the foreign keys accept and the
    // caller does not own. The organisation is flushed first — `organizationId`
    // is a plain uuid column, so MikroORM cannot order the inserts by FK.
    const foreignOrg = em.create(Organization, {
      name: 'Quick Order Foreign Co',
      taxId: 'PL0000000769',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Obca 769',
        city: 'Krakow',
        postalCode: '30-769',
        country: 'PL',
      },
    });
    await em.persistAndFlush(foreignOrg);
    const foreign = em.create(Address, {
      organizationId: foreignOrg.id,
      kind: 'delivery',
      recipientName: 'Quick order foreign address',
      street: 'ul. Obca 769',
      city: 'Krakow',
      postalCode: '30-769',
      country: 'PL',
    });
    await em.persistAndFlush(foreign);
    foreignAddressId = foreign.id;
    // Issue #769 — an address from the caller's **personal** book (`customers`).
    // The preference table's address columns reference the organisation book
    // (`addresses`) only, so this id can never be stored there.
    const personal = em.create(CustomerAddress, {
      customerAccountId: TEST_CUSTOMER_ID,
      kind: 'delivery',
      recipientName: 'Quick order personal address',
      street: 'ul. Prywatna 769',
      city: 'Warszawa',
      postalCode: '00-769',
      country: 'PL',
    });
    await em.persistAndFlush(personal);
    personalAddressId = personal.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upserts the caller’s own customer-scope defaults and reads them back', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies: COOKIE,
      payload: {
        scope: 'customer',
        scopeId: TEST_CUSTOMER_ID,
        defaultPaymentMethodId: paymentId,
        defaultBillingAddressId: ownAddressId,
      },
    });
    expect(put.statusCode).toBe(200);

    const raw = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quick-order/preferences?scope=customer&scopeId=${TEST_CUSTOMER_ID}`,
      cookies: COOKIE,
    });
    expect(raw.statusCode).toBe(200);
    const data = (raw.json() as { data: { defaultPaymentMethodId: string; defaultBillingAddressId: string } })
      .data;
    expect(data.defaultPaymentMethodId).toBe(paymentId);
    expect(data.defaultBillingAddressId).toBe(ownAddressId);
  });

  it('returns eligible defaults in the resolved view', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/preferences/resolved',
      cookies: COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { paymentMethodId: string | null; billingAddressId: string | null };
    };
    expect(body.data.paymentMethodId).toBe(paymentId);
    expect(body.data.billingAddressId).toBe(ownAddressId);
  });

  it('refuses an address belonging to another organization with 403 ADDRESS_NOT_OWNED', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies: COOKIE,
      payload: {
        scope: 'customer',
        scopeId: TEST_CUSTOMER_ID,
        defaultShippingAddressId: foreignAddressId,
      },
    });
    expect(put.statusCode).toBe(403);
    expect((put.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ADDRESS_NOT_OWNED,
    );
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/preferences/resolved',
      cookies: COOKIE,
    });
    expect((res.json() as { data: { shippingAddressId: string | null } }).data.shippingAddressId).toBeNull();
  });

  it('refuses a personal-book address as a default with 403 ADDRESS_NOT_OWNED, not a database error (issue #769)', async () => {
    for (const field of ['defaultBillingAddressId', 'defaultShippingAddressId'] as const) {
      const put = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/quick-order/preferences',
        cookies: COOKIE,
        payload: { scope: 'customer', scopeId: TEST_CUSTOMER_ID, [field]: personalAddressId },
      });
      expect(put.statusCode).toBe(403);
      expect((put.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.ADDRESS_NOT_OWNED,
      );
    }
    // Nothing was written: the earlier organisation-book default still stands.
    const raw = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quick-order/preferences?scope=customer&scopeId=${TEST_CUSTOMER_ID}`,
      cookies: COOKIE,
    });
    expect((raw.json() as { data: { defaultBillingAddressId: string } }).data.defaultBillingAddressId).toBe(
      ownAddressId,
    );
  });

  it('writes an audit entry for each preference change', async () => {
    const count = await h.em().count(AuditLogEntry, {
      action: 'quick_order.default_preference.update',
      objectType: 'QuickOrderDefaultPreference',
    });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('forbids managing another customer’s defaults', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies: COOKIE,
      payload: {
        scope: 'customer',
        scopeId: '00000000-0000-4000-8000-0000000000ff',
        defaultPaymentMethodId: null,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('forbids a regular user from managing organization-scope defaults', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies: { b2b_session: 'stub-regular-user-session' },
      payload: {
        scope: 'organization',
        scopeId: TEST_ORGANIZATION_ID,
        defaultPaymentMethodId: null,
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
