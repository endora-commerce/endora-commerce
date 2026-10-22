import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE, ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  PriceDisplayModeOverride,
  Product,
} from '../../helpers/package-entities.js';
import { hasBasePriceSql, removeBasePriceSql, seedBasePriceSql } from '../../helpers/price-book-sql.js';
import {
  createMinimumProduct,
  minimumFixtureRun,
  setProductMinimum,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

const [NOT_FOUND, NOT_VISIBLE, NOT_IN_CHANNEL, QUOTE_ONLY, , BELOW_MINIMUM] = ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE;

const ADMIN = { b2b_session: 'stub-admin-session' };
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000a1450';
const MISSING_PRODUCT_ID = '00000000-0000-4000-8000-0000000149ff';
const MISSING_CHANNEL_ID = '00000000-0000-4000-8000-00000000dead';

/** Priced throughout: the line that proves the others do not take it down. */
const PRICED = SEED_PRODUCT_101_ID;
/** Its visibility allow-list is varied per case and restored after the file. */
const SUBJECT = SEED_PRODUCT_102_ID;
/** Withheld (`displayMode: 'none'`) for the whole file. */
const QUOTE_ONLY_PRODUCT = SEED_PRODUCT_103_ID;

interface PreviewBody {
  data: {
    lines: Array<{ productId: string; unitPrice: string; lineTotal: number; unavailable?: boolean }>;
    summary: { subtotal: number; taxTotal: number; total: number };
    messages: Array<{ productId: string; code: string; minimum?: number }>;
  };
}

/**
 * Feature 145 (US1 sc. 6, 11–14; FR-024, FR-027) — the admin order preview
 * names why a line cannot be ordered: the customer may not see the product, or
 * the order's chosen channel does not sell it. One message per line, in the
 * order `PRODUCT_NOT_FOUND` > visibility > assortment > `QUOTE_ONLY`, and the
 * assortment is the **body's** `salesChannelId` — a channel naming no row is
 * refused rather than replaced by another one.
 */
describe('Admin order preview — visibility and assortment codes (feature 145)', () => {
  let h: BackendServerHandle;
  /** The system default: every seed product is a member. */
  let channelA: string;
  /** Created here with no products. */
  let channelB: string;
  let listedHere = false;
  const RUN = minimumFixtureRun();
  /** Feature 155 — a product with a pieces minimum of 10, visible and on channel A. */
  let M: MinimumProductFixture;
  /** Feature 155 — the same minimum, but restricted to another Organization. */
  let MH: MinimumProductFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    const systemDefault = await em.findOne(SalesChannel, { systemDefault: true });
    expect(systemDefault).not.toBeNull();
    channelA = systemDefault!.id;

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: ADMIN,
      payload: {
        code: 'preview-availability-b',
        name: { 'en-US': 'Preview availability B' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    channelB = (created.json() as { id: string }).id;

    // Quote-only needs a resolved price whose mode is `none` — see
    // `test/integration/carts/cart-line-refusal-codes.test.ts`.
    if (!(await hasBasePriceSql(em, QUOTE_ONLY_PRODUCT))) {
      listedHere = true;
      await seedBasePriceSql(em, QUOTE_ONLY_PRODUCT, '100.00');
    }
    em.create(PriceDisplayModeOverride, {
      scope: 'product',
      targetId: QUOTE_ONLY_PRODUCT,
      mode: 'none',
    });
    await em.flush();

    M = await createMinimumProduct(em, {
      sku: `APM-M-${RUN}`,
      nameEn: `Minimum ${RUN}`,
      namePl: `Minimum ${RUN}`,
      minOrderQuantity: 10,
      channelIds: [channelA],
    });
    MH = await createMinimumProduct(em, {
      sku: `APM-H-${RUN}`,
      nameEn: `Hidden minimum ${RUN}`,
      namePl: `Ukryte minimum ${RUN}`,
      minOrderQuantity: 10,
      channelIds: [channelA],
    });
    await em.nativeUpdate(Product, { id: MH.id }, { allowedOrganizationIds: [OTHER_ORG_ID] });
  });

  afterAll(async () => {
    const em = h.em();
    await em.nativeUpdate(Product, { id: SUBJECT }, { allowedOrganizationIds: [] });
    await em.nativeUpdate(Product, { id: PRICED }, { deletedAt: null });
    await em.nativeDelete(PriceDisplayModeOverride, { scope: 'product', targetId: QUOTE_ONLY_PRODUCT });
    if (listedHere) await removeBasePriceSql(em, QUOTE_ONLY_PRODUCT);
    await teardownBackendServer(h);
  });

  async function allowSubjectTo(organizationIds: string[]): Promise<void> {
    await h.em().nativeUpdate(Product, { id: SUBJECT }, { allowedOrganizationIds: organizationIds });
  }

  async function preview(
    salesChannelId: string,
    productIds: string[],
  ): Promise<{ statusCode: number; json: () => unknown }> {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: ADMIN,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId,
        items: productIds.map((productId) => ({ productId, quantity: 1 })),
      },
    });
  }

  async function previewItems(
    salesChannelId: string,
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<PreviewBody['data']> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: ADMIN,
      payload: { customerAccountId: TEST_CUSTOMER_ID, salesChannelId, items },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as PreviewBody).data;
  }

  async function previewOk(salesChannelId: string, productIds: string[]): Promise<PreviewBody['data']> {
    const res = await preview(salesChannelId, productIds);
    expect(res.statusCode).toBe(200);
    return (res.json() as PreviewBody).data;
  }

  /** Exactly one message per unavailable line, and none for an available one. */
  function expectOneMessagePerUnavailableLine(data: PreviewBody['data']): void {
    const unavailable = data.lines.filter((l) => l.unavailable).map((l) => l.productId);
    expect(data.messages.map((m) => m.productId).sort()).toEqual([...unavailable].sort());
  }

  function codeFor(data: PreviewBody['data'], productId: string): string | undefined {
    return data.messages.find((m) => m.productId === productId)?.code;
  }

  function expectPriced(data: PreviewBody['data'], productId: string): void {
    const line = data.lines.find((l) => l.productId === productId)!;
    expect(line.unavailable).toBeUndefined();
    expect(Number(line.unitPrice)).toBeGreaterThan(0);
    expect(codeFor(data, productId)).toBeUndefined();
  }

  function expectUnavailable(data: PreviewBody['data'], productId: string, code: string): void {
    const line = data.lines.find((l) => l.productId === productId)!;
    expect(line).toMatchObject({ unitPrice: '0', lineTotal: 0, unavailable: true });
    expect(codeFor(data, productId)).toBe(code);
  }

  it('sc. 11 — an allow-list excluding the customer\'s org: visibility code, the other line priced', async () => {
    await allowSubjectTo([OTHER_ORG_ID]);
    const data = await previewOk(channelA, [PRICED, SUBJECT]);

    expectUnavailable(data, SUBJECT, NOT_VISIBLE);
    expectPriced(data, PRICED);
    const pricedLine = data.lines.find((l) => l.productId === PRICED)!;
    expect(data.summary.subtotal).toBeCloseTo(pricedLine.lineTotal, 2);
    expectOneMessagePerUnavailableLine(data);
  });

  it('sc. 12 — a visible product outside channel B: assortment code on B, priced on A', async () => {
    await allowSubjectTo([]);

    const onB = await previewOk(channelB, [SUBJECT]);
    expectUnavailable(onB, SUBJECT, NOT_IN_CHANNEL);
    expect(onB.summary.subtotal).toBe(0);
    expectOneMessagePerUnavailableLine(onB);

    const onA = await previewOk(channelA, [SUBJECT]);
    expectPriced(onA, SUBJECT);
    expect(onA.messages).toHaveLength(0);
  });

  it('sc. 13 — restricted and out of channel: only the visibility code, on both channels', async () => {
    await allowSubjectTo([OTHER_ORG_ID]);
    for (const channel of [channelA, channelB]) {
      const data = await previewOk(channel, [SUBJECT]);
      expectUnavailable(data, SUBJECT, NOT_VISIBLE);
      expect(data.messages).toHaveLength(1);
    }
  });

  it('sc. 13 — the customer\'s org permitted, on channel B: the assortment code', async () => {
    await allowSubjectTo([TEST_ORGANIZATION_ID]);
    const data = await previewOk(channelB, [SUBJECT]);
    expectUnavailable(data, SUBJECT, NOT_IN_CHANNEL);
    expect(data.messages).toHaveLength(1);
  });

  it('an unknown product id is PRODUCT_NOT_FOUND only, on any channel', async () => {
    for (const channel of [channelA, channelB]) {
      const data = await previewOk(channel, [MISSING_PRODUCT_ID]);
      expectUnavailable(data, MISSING_PRODUCT_ID, NOT_FOUND);
      expect(data.messages).toHaveLength(1);
    }
  });

  it('a quote-only product, visible and in channel, is QUOTE_ONLY only', async () => {
    await allowSubjectTo([]);
    const data = await previewOk(channelA, [QUOTE_ONLY_PRODUCT, SUBJECT]);
    expectUnavailable(data, QUOTE_ONLY_PRODUCT, QUOTE_ONLY);
    expectPriced(data, SUBJECT);
    expectOneMessagePerUnavailableLine(data);
  });

  it('a quote-only product outside the channel reports the assortment code, not QUOTE_ONLY', async () => {
    const data = await previewOk(channelB, [QUOTE_ONLY_PRODUCT]);
    expectUnavailable(data, QUOTE_ONLY_PRODUCT, NOT_IN_CHANNEL);
    expect(data.messages).toHaveLength(1);
  });

  it('sc. 14 — a salesChannelId naming no channel is 404 NOT_FOUND, never priced on another channel', async () => {
    // An active channel exists (A and B both are): the removed fallback would
    // have found one.
    const res = await preview(MISSING_CHANNEL_ID, [PRICED]);
    expect(res.statusCode).toBe(404);
    // The code, not the sentence: the error envelope answers NOT_FOUND in the
    // caller's language rather than with the thrower's English text.
    const body = res.json() as { error: { code: string }; data?: unknown };
    expect(body.error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(body.data).toBeUndefined();
  });

  it('a soft-deleted product on a valid channel is priced, as today', async () => {
    await h.em().nativeUpdate(Product, { id: PRICED }, { deletedAt: new Date() });
    try {
      const data = await previewOk(channelA, [PRICED]);
      expectPriced(data, PRICED);
      expect(data.messages).toHaveLength(0);
    } finally {
      await h.em().nativeUpdate(Product, { id: PRICED }, { deletedAt: null });
    }
  });
  describe('feature 155 — BELOW_MINIMUM_QUANTITY, last in the precedence (FR-009, FR-035)', () => {
    function messageFor(data: PreviewBody['data'], productId: string) {
      return data.messages.find((m) => m.productId === productId);
    }

    it('a line below its product\'s minimum is marked BELOW_MINIMUM_QUANTITY with the minimum; the other line priced', async () => {
      const data = await previewItems(channelA, [
        { productId: M.id, quantity: 5 },
        { productId: PRICED, quantity: 1 },
      ]);
      expectUnavailable(data, M.id, BELOW_MINIMUM);
      expect(messageFor(data, M.id)).toEqual({ productId: M.id, code: BELOW_MINIMUM, minimum: 10 });
      expectPriced(data, PRICED);
      const pricedLine = data.lines.find((l) => l.productId === PRICED)!;
      expect(data.summary.subtotal).toBeCloseTo(pricedLine.lineTotal, 2);
      expectOneMessagePerUnavailableLine(data);
    });

    it('D1 — two lines of the product totalling the minimum carry no message', async () => {
      const data = await previewItems(channelA, [
        { productId: M.id, quantity: 5 },
        { productId: M.id, quantity: 5 },
      ]);
      expect(data.messages).toEqual([]);
      for (const line of data.lines) expect(line.unavailable).toBeUndefined();
    });

    it('every line of a product below its minimum is marked, one message each', async () => {
      const data = await previewItems(channelA, [
        { productId: M.id, quantity: 3 },
        { productId: M.id, quantity: 4 },
      ]);
      expect(data.messages).toEqual([
        { productId: M.id, code: BELOW_MINIMUM, minimum: 10 },
        { productId: M.id, code: BELOW_MINIMUM, minimum: 10 },
      ]);
      expect(data.summary.subtotal).toBe(0);
    });

    it('F1 — hidden and below the minimum: PRODUCT_NOT_VISIBLE_TO_CUSTOMER only, and no minimum', async () => {
      const data = await previewItems(channelA, [{ productId: MH.id, quantity: 5 }]);
      expectUnavailable(data, MH.id, NOT_VISIBLE);
      expect(data.messages).toEqual([{ productId: MH.id, code: NOT_VISIBLE }]);
    });

    it('outside the channel and below the minimum: the assortment code only, and no minimum', async () => {
      const data = await previewItems(channelB, [{ productId: M.id, quantity: 5 }]);
      expect(data.messages).toEqual([{ productId: M.id, code: NOT_IN_CHANNEL }]);
    });

    it('quote-only and below the minimum: QUOTE_ONLY only, and no minimum', async () => {
      const before = await h.em().fork().findOneOrFail(Product, { id: QUOTE_ONLY_PRODUCT }, { filters: false });
      const previous = before.minOrderQuantity ?? null;
      await setProductMinimum(h.em(), QUOTE_ONLY_PRODUCT, 10);
      try {
        const data = await previewItems(channelA, [{ productId: QUOTE_ONLY_PRODUCT, quantity: 5 }]);
        expect(data.messages).toEqual([{ productId: QUOTE_ONLY_PRODUCT, code: QUOTE_ONLY }]);
      } finally {
        await setProductMinimum(h.em(), QUOTE_ONLY_PRODUCT, previous);
      }
    });

    it('a hidden line beside a visible below-minimum one: each keeps its own code', async () => {
      const data = await previewItems(channelA, [
        { productId: MH.id, quantity: 10 },
        { productId: M.id, quantity: 5 },
      ]);
      expect(messageFor(data, MH.id)?.code).toBe(NOT_VISIBLE);
      expect(messageFor(data, M.id)).toEqual({ productId: M.id, code: BELOW_MINIMUM, minimum: 10 });
    });
  });
});
