import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import type { CartSnapshot } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import type { PromotionService } from '../../../../packages/modules/promotions/src/backend/services/promotion-service.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { Promotion } from '../../helpers/package-entities.js';

/**
 * Issue #251 — the four gates four optional constructor arguments used to
 * switch off.
 *
 * `salesChannelMembership`, `dictionaryValidator`, `resolveOrganizationStatus`
 * and `auditLog` were all optional and all supplied by `backend.ts`, so their
 * absent branches ran nowhere in production and everywhere in the tests:
 * `promotionServiceFor` built a service with none of the four, which is a
 * quieter and strictly more permissive object than the composed one. Ten
 * suites were written against it.
 *
 * These four cases are the gates, asserted through **the helper**, because the
 * helper is where the absence was. Each one is red before the arguments become
 * required:
 *
 *   - no `resolveOrganizationStatus` → a blocked Organization keeps collecting
 *     its org-targeted discounts (feature 026 US5, the one that matters);
 *   - no `salesChannelMembership` → a new promotion binds to no channel and
 *     `applyToCart` skips channel filtering, so a channel-scoped promotion
 *     applies in every channel (Principle XII);
 *   - no `dictionaryValidator` → an unknown currency code is stored;
 *   - no `auditLog` → the write records no audit row (Principle XIII).
 *
 * `org-status-gate.test.ts` and `channel-binding.test.ts` cover the first two
 * against `h.promotions.promotionService`, the container-built service that
 * always had the arguments. That is the other half of the proof: the gates
 * worked, and the helper was the thing that skipped them.
 */
describe('PromotionService — the gates its optional arguments used to skip (issue #251)', () => {
  let h: BackendServerHandle;
  let svc: PromotionService;
  let blockedOrgId: string;
  let defaultChannelId: string;
  let otherChannelId: string;

  const PRODUCT_A = '00000000-0000-4000-8000-000000000001';
  const NAME_PREFIX = 'issue 251 — ';

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = promotionServiceFor(h);

    const em = h.em();
    const blocked = em.create(Organization, {
      name: 'Blocked Org for issue 251',
      taxId: `PL251B${Date.now().toString().slice(-8)}`,
      status: 'blocked',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Zablokowana 251',
        city: 'Warszawa',
        postalCode: '00-251',
        country: 'PL',
      },
    });
    const otherChannel = em.create(SalesChannel, {
      code: 'issue-251-other-channel',
      name: { en: 'Issue 251 other channel' },
      defaultLanguage: 'en-US',
      defaultCurrency: 'PLN',
      languages: ['en-US'],
      currencies: ['PLN'],
      isPublic: false,
      active: true,
      systemDefault: false,
      version: 1,
    });
    await em.persistAndFlush([blocked, otherChannel]);
    blockedOrgId = blocked.id;
    otherChannelId = otherChannel.id;
    defaultChannelId = (await h.salesChannels.resolver.getSystemDefault()).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * Scoped to this suite's own rows, not `truncate promotions cascade` (issue
   * #166): the table is shared, and a wipe would make every assertion below a
   * claim about the platform rather than about the promotion the test wrote.
   * `sales_channel_promotions_promotion_fk` is `on delete cascade`, so the
   * channel bindings go with them.
   */
  beforeEach(async () => {
    await h.em().nativeDelete(Promotion, { name: { $like: `${NAME_PREFIX}%` } });
  });

  function snapshot(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
    return {
      organizationId: null,
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
      ...overrides,
    };
  }

  /** Which of `applyToCart`'s applications is the promotion this test wrote. */
  function appliedIds(application: { appliedPromotions: Array<{ promotionId: string }> }): string[] {
    return application.appliedPromotions.map((p) => p.promotionId);
  }

  it('refuses an org-targeted promotion to a blocked Organization', async () => {
    const promo = await svc.upsert({
      name: `${NAME_PREFIX}10% off for the blocked org`,
      kind: 'percentage_off',
      value: 10,
      organizationId: blockedOrgId,
    });

    const result = await svc.applyToCart(snapshot({ organizationId: blockedOrgId }));

    expect(appliedIds(result)).not.toContain(promo.id);
  });

  it('applies a channel-scoped promotion in its own channel and nowhere else', async () => {
    // `upsert` binds a new promotion to the system-default channel; the other
    // channel is one it was never bound to.
    const promo = await svc.upsert({
      name: `${NAME_PREFIX}10% off in the default channel`,
      kind: 'percentage_off',
      value: 10,
    });

    const inOwnChannel = await svc.applyToCart(snapshot({ salesChannelId: defaultChannelId }));
    expect(appliedIds(inOwnChannel)).toContain(promo.id);

    const elsewhere = await svc.applyToCart(snapshot({ salesChannelId: otherChannelId }));
    expect(appliedIds(elsewhere)).not.toContain(promo.id);
  });

  it('refuses a promotion whose currency is not a known dictionary entry', async () => {
    await expect(
      svc.upsert({
        name: `${NAME_PREFIX}50 ZZZ off`,
        kind: 'amount_off',
        value: 50,
        currency: 'ZZZ',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_NOT_FOUND' });
  });

  it('records an audit row for a promotion write', async () => {
    const promo = await svc.upsert({
      name: `${NAME_PREFIX}audited promotion`,
      kind: 'percentage_off',
      value: 5,
    });

    const entries = await h
      .em()
      .find(AuditLogEntry, { objectType: 'promotion', objectId: promo.id });

    expect(entries.map((e) => e.action)).toContain('promotion.create');
  });
});
