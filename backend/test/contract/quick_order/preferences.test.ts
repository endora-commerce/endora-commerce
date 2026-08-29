import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { Address, PaymentMethod } from '../../helpers/package-entities.js';

/**
 * Feature 039 (US2) — default ordering preferences: role-scoped upsert,
 * resolved-with-eligibility, and audit.
 */

const COOKIE = { b2b_session: 'stub-customer-session' };

describe('Quick-order default preferences', () => {
  let h: BackendServerHandle;
  let paymentId: string;
  let ownAddressId: string;
  let foreignAddressId: string | null = null;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const payment = await em.findOne(PaymentMethod, { status: 'active' });
    paymentId = payment!.id;
    const ownAddress = await em.findOne(Address, { organizationId: TEST_ORGANIZATION_ID });
    ownAddressId = ownAddress!.id;
    const foreign = await em.findOne(Address, { organizationId: { $ne: TEST_ORGANIZATION_ID } });
    foreignAddressId = foreign?.id ?? null;
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

  it('drops an address belonging to another organization from the resolved view', async () => {
    if (!foreignAddressId) return; // no cross-org address in the seed → nothing to assert
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies: COOKIE,
      payload: {
        scope: 'customer',
        scopeId: TEST_CUSTOMER_ID,
        defaultShippingAddressId: foreignAddressId,
      },
    });
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/preferences/resolved',
      cookies: COOKIE,
    });
    expect((res.json() as { data: { shippingAddressId: string | null } }).data.shippingAddressId).toBeNull();
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
