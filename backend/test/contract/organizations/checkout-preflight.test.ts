import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedSuspendedOrganization } from '../../helpers/seed-commerce.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { PaymentMethod } from '../../helpers/package-entities.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 026 US4 — Storefront checkout preflight contract.
 *
 *   POST /api/v1/storefront/checkout/preflight
 *
 * Returns 200 with the resolved allow-list IDs when the caller's
 * Organization is active; returns 423 with status + reason when the
 * Organization cannot transact (pending_verification / blocked / rejected);
 * returns 200 with empty allow-lists for no-org Customer accounts
 * (platform defaults apply, feature 026 US2).
 *
 * Also asserts the payment-methods storefront endpoint honors the org's
 * allow-list: when a non-empty list is configured, only those methods are
 * returned.
 */
describe('Storefront preflight + payment-method allow-list (feature 026 US4)', () => {
  let h: BackendServerHandle;
  let paymentMethodIds: string[];
  let restrictedPaymentId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedSuspendedOrganization(h.em());

    const em = h.em();
    const allMethods = await em.find(PaymentMethod, { status: 'active' });
    paymentMethodIds = allMethods.map((m) => m.id);
    // We need at least 2 active payment methods to demonstrate filtering.
    // Add a fresh one if the seed only has one.
    if (paymentMethodIds.length < 2) {
      const extra = em.create(PaymentMethod, {
        code: `test-us4-${Date.now()}`,
        name: { en: 'US4 Test Method' },
        kind: 'bank_transfer',
        adapter: 'bank_transfer',
        status: 'active',
        statusOnPending: 'new',
        statusOnSuccess: 'paid',
        statusOnFailure: 'cancelled',
      });
      await em.persistAndFlush(extra);
      paymentMethodIds.push(extra.id);
    }
    restrictedPaymentId = paymentMethodIds[0]!;
  });

  afterAll(async () => {
    // Clear restrictions on TEST_ORGANIZATION so other test files start fresh.
    try {
      const fresh = await h.em().findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
      await h.organizations.restrictionService.replaceAllowLists(TEST_ORGANIZATION_ID, {
        expectedVersion: fresh.version,
        paymentMethodIds: [],
        deliveryMethodIds: [],
        warehouseIds: [],
      });
    } catch {
      // Best-effort cleanup; not all suites depend on it.
    }
    await teardownBackendServer(h);
  });

  it('returns 200 with empty allow-lists when no restrictions are configured', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout/preflight',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      canTransact: boolean;
      allowedPaymentMethodIds: string[];
      allowedDeliveryMethodIds: string[];
      assignedWarehouseIds: string[];
    };
    expect(body.canTransact).toBe(true);
    expect(body.allowedPaymentMethodIds).toEqual([]);
    expect(body.allowedDeliveryMethodIds).toEqual([]);
    expect(body.assignedWarehouseIds).toEqual([]);
  });

  it('returns the configured payment-method allow-list once restrictions are set', async () => {
    h.em().clear();
    const fresh = await h.em().findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    await h.organizations.restrictionService.replaceAllowLists(TEST_ORGANIZATION_ID, {
      expectedVersion: fresh.version,
      paymentMethodIds: [restrictedPaymentId],
      deliveryMethodIds: [],
      warehouseIds: [],
    });

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout/preflight',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { allowedPaymentMethodIds: string[] };
    expect(body.allowedPaymentMethodIds).toEqual([restrictedPaymentId]);
  });

  it('storefront /payment-methods endpoint honors the allow-list', async () => {
    // Restriction is still configured from the previous test.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/payment-methods',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }> };
    const returnedIds = body.data.map((m) => m.id);
    expect(returnedIds).toEqual([restrictedPaymentId]);
  });

  it('returns 423 when the customer Organization cannot transact', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/checkout/preflight',
      cookies: { b2b_session: 'stub-customer-session-suspended' },
      payload: {},
    });
    expect(res.statusCode).toBe(423);
    const body = res.json() as { canTransact: boolean; status: string; reason: string };
    expect(body.canTransact).toBe(false);
    expect(body.status).toBe('blocked');
    expect(typeof body.reason).toBe('string');
    expect(body.reason.length).toBeGreaterThan(0);
  });
});
