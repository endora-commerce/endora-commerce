import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { CartSnapshot } from '@endora-commerce/contracts';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';

/**
 * Feature 026 US5 — Org-status gate on promotions.
 *
 * A promotion that targets a specific Organization MUST only apply when
 * that Organization is in `active` state. When the Organization is
 * `pending_verification`, `blocked`, or `rejected`, the promotion is
 * skipped — even if the cart's other criteria match.
 *
 * This test exercises the gate via the test-harness's
 * promotions-module wiring (which has the resolveOrganizationStatus
 * closure wired identically to the production composition).
 */
describe('PromotionService — org-status gate (feature 026 US5)', () => {
  let h: BackendServerHandle;
  let activeOrgId: string;
  let blockedOrgId: string;
  let pendingOrgId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const active = em.create(Organization, {
      name: 'Active Org for Promo Gate',
      taxId: `PL026PA${Date.now().toString().slice(-8)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Aktywna 1',
        city: 'Warszawa',
        postalCode: '00-009',
        country: 'PL',
      },
    });
    const blocked = em.create(Organization, {
      name: 'Blocked Org for Promo Gate',
      taxId: `PL026PB${Date.now().toString().slice(-8)}`,
      status: 'blocked',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Zablokowana 1',
        city: 'Warszawa',
        postalCode: '00-010',
        country: 'PL',
      },
    });
    const pending = em.create(Organization, {
      name: 'Pending Org for Promo Gate',
      taxId: `PL026PP${Date.now().toString().slice(-8)}`,
      status: 'pending_verification',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Oczekujaca 1',
        city: 'Warszawa',
        postalCode: '00-011',
        country: 'PL',
      },
    });
    await em.persistAndFlush([active, blocked, pending]);
    activeOrgId = active.id;
    blockedOrgId = blocked.id;
    pendingOrgId = pending.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
  });

  const PRODUCT_A = '00000000-0000-4000-8000-000000000001';

  function snapshot(orgId: string): CartSnapshot {
    return {
      organizationId: orgId,
      customerGroupId: null,
      currency: 'PLN',
      deliveryTotal: 20,
      promotionCode: null,
      lines: [
        {
          productId: PRODUCT_A,
          variantId: null,
          categoryIds: [],
          quantity: 1,
          unitPrice: { amount: 100, currency: 'PLN' },
        },
      ],
    };
  }

  it('applies an org-targeted promotion when the Organization is active', async () => {
    await h.promotions.promotionService.upsert({
      name: '10% off for Active Org',
      kind: 'percentage_off',
      value: 10,
      organizationId: activeOrgId,
    });
    const result = await h.promotions.promotionService.applyToCart(snapshot(activeOrgId));
    expect(result.discountTotal).toBe(10);
  });

  it('skips an org-targeted promotion when the Organization is blocked', async () => {
    await h.promotions.promotionService.upsert({
      name: '10% off for Blocked Org',
      kind: 'percentage_off',
      value: 10,
      organizationId: blockedOrgId,
    });
    const result = await h.promotions.promotionService.applyToCart(snapshot(blockedOrgId));
    expect(result.discountTotal).toBe(0);
  });

  it('skips an org-targeted promotion when the Organization is pending_verification', async () => {
    await h.promotions.promotionService.upsert({
      name: '10% off for Pending Org',
      kind: 'percentage_off',
      value: 10,
      organizationId: pendingOrgId,
    });
    const result = await h.promotions.promotionService.applyToCart(snapshot(pendingOrgId));
    expect(result.discountTotal).toBe(0);
  });

  it('still applies platform-wide (no org filter) promotions to a blocked-org cart', async () => {
    await h.promotions.promotionService.upsert({
      name: '10% off everyone',
      kind: 'percentage_off',
      value: 10,
      // no organizationId — applies to any cart
    });
    const result = await h.promotions.promotionService.applyToCart(snapshot(blockedOrgId));
    expect(result.discountTotal).toBe(10);
  });
});
