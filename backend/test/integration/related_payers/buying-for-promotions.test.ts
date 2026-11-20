import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { emptyCustomerBasket } from '../../helpers/customer-basket.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Tax } from '../../helpers/package-entities.js';
import { randomUUID } from 'node:crypto';
import { ADMIN, makeAddress, makeOrganization } from './fixtures.js';

/**
 * `specs/182-related-payers/` FR-112, FR-113, FR-117 (RP-18 b) — on the payer's commercial terms
 * promotions are evaluated for the payer: a promotion restricted to the payer applies and one
 * restricted to the buyer does not; the switch names the promotions added and removed; and the
 * order carries the payer's discount, its use recorded for the payer.
 */
const SESSION = { b2b_session: 'stub-customer-session' };

describe('related_payers — promotions on the payer\'s terms (FR-112)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let payer: string;
  let payerBilling: string;
  let linkId: string;
  let payerPromotion: string;
  let buyerPromotion: string;
  /** RP-19 (b) — a minimum spend between the net (19.99) and the gross (24.59 at 23 %) of the cart. */
  let thresholdPromotion: string;
  const TAX_CODE = `rp182-promo-vat-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { systemDefault: true })).id;
    expect(
      (
        await h.app.inject({
          method: 'PUT',
          url: '/api/v1/admin/settings/related_payers.enabled/value',
          cookies: ADMIN,
          payload: { scope: 'all', value: true },
        })
      ).statusCode,
    ).toBe(200);
    payer = await makeOrganization(em, 'Promotions payer');
    payerBilling = await makeAddress(em, payer, 'billing');
    em.create(Tax, { code: TAX_CODE, name: TAX_CODE, rate: '0.2300', productType: 'simple', priority: 1000 } as never);
    await em.flush();
    const promotions = promotionServiceFor(h);
    thresholdPromotion = (
      await promotions.upsert({ name: 'FR-112 payer gross threshold', kind: 'percentage_off', value: 1, organizationId: payer, minCartSubtotal: 22 } as never)
    ).id;
    payerPromotion = (await promotions.upsert({ name: 'FR-112 payer only', kind: 'percentage_off', value: 10, organizationId: payer } as never)).id;
    buyerPromotion = (
      await promotions.upsert({ name: 'FR-112 buyer only', kind: 'percentage_off', value: 5, organizationId: TEST_ORGANIZATION_ID } as never)
    ).id;
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: payer, commercialTerms: 'payer' },
    });
    expect(link.statusCode, link.body).toBe(201);
    linkId = link.json().data.id;
    await emptyCustomerBasket(h, { ...CUSTOMER_COOKIES[SESSION.b2b_session]!, salesChannelId: channelId });
    const added = await h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: SESSION, payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 } });
    expect(added.statusCode, added.body).toBe(200);
  }, 5 * 60_000);

  afterAll(async () => {
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/related-payers/links/${linkId}/revoke`, cookies: ADMIN, payload: {} });
    await h.em().getConnection().execute('delete from promotions where id in (?, ?, ?)', [payerPromotion, buyerPromotion, thresholdPromotion]);
    await h.em().nativeDelete(Tax, { code: TAX_CODE });
    await emptyCustomerBasket(h, { ...CUSTOMER_COOKIES[SESSION.b2b_session]!, salesChannelId: channelId });
    await teardownBackendServer(h);
  });

  const applied = async (): Promise<string[]> => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: SESSION });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().data.appliedPromotions as Array<{ promotionId: string }>).map((p) => p.promotionId);
  };

  it('the buyer\'s own context applies the buyer\'s promotion and not the payer\'s', async () => {
    const ids = await applied();
    expect(ids).toContain(buyerPromotion);
    expect(ids).not.toContain(payerPromotion);
  });

  it('Buying for Y applies Y\'s promotion, drops X\'s, and the switch says so (FR-113)', async () => {
    const res = await h.app.inject({ method: 'PUT', url: '/api/v1/cart/buying-for', cookies: SESSION, payload: { payerOrganizationId: payer } });
    expect(res.statusCode, res.body).toBe(200);
    const repricing = res.json().data.repricing as {
      promotionsAdded: Array<{ promotionId: string }>;
      promotionsRemoved: Array<{ promotionId: string }>;
    };
    expect(repricing.promotionsAdded.map((p) => p.promotionId)).toContain(payerPromotion);
    // RP-19 (b) — judged on the gross, as the cart judges it: the cart applies it, so the switch names it.
    expect(repricing.promotionsAdded.map((p) => p.promotionId)).toContain(thresholdPromotion);
    expect(repricing.promotionsRemoved.map((p) => p.promotionId)).toContain(buyerPromotion);
    const ids = await applied();
    expect(ids).toContain(payerPromotion);
    expect(ids).toContain(thresholdPromotion);
    expect(ids).not.toContain(buyerPromotion);
  });

  it('the order carries Y\'s promotion and records its use for Y (FR-117)', async () => {
    const { SEED_ADDRESS_DELIVERY_ID, SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } = await import('../../helpers/seed-commerce.js');
    const placed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: SESSION,
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: payerBilling,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        payerOrganizationId: payer,
      },
    });
    expect(placed.statusCode, placed.body).toBe(201);
    const orderId = placed.json().data.id as string;
    const usages = (await h.em().getConnection().execute(
      'select promotion_id, organization_id from promotion_usages where order_id = ?',
      [orderId],
    )) as Array<{ promotion_id: string; organization_id: string }>;
    expect(usages.map((u) => u.promotion_id)).toContain(payerPromotion);
    expect(usages.map((u) => u.promotion_id)).not.toContain(buyerPromotion);
    expect(usages.find((u) => u.promotion_id === payerPromotion)?.organization_id).toBe(payer);
  });
});
