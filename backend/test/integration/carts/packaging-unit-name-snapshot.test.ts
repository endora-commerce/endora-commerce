import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import type { CartWritePort } from '@endora-commerce/contracts';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  createMinimumPackagingUnit,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Feature 163, Phase 22 (T138; owner decision N2 = B, 2026-10-26), on feature 170's model — a
 * caller that names the channel itself (an operator surface, through `CartWritePort` with
 * `salesChannelId`) has no request language: the packaging-unit name is snapshotted at that
 * channel's **default language**, through the C×L → C → Global chain, as the product name beside
 * it is. No HTTP route passes a unit with a named channel today, so the case drives the port as
 * such a surface would.
 *
 * The buyer-request cases of this file (snapshot in the basket language, kept after a change,
 * Global fallback, the order line) moved to `effective-text-lines.test.ts` and
 * `orders/effective-text-snapshot.test.ts` (feature 170, T050 / T051) when the 163
 * `nameTranslations` map they wrote was retired.
 */

describe('163 / 170 — packaging-unit name snapshot for an operator naming the channel (N2) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let product: MinimumProductFixture;
  let unitId: string;
  let channelId: string;

  const completeActiveBaskets = () =>
    h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    channelId = channel.id;
    product = await createMinimumProduct(em, {
      sku: `S163-PU-${RUN}`,
      nameEn: 'Shelf',
      namePl: 'Shelf',
      channelIds: [channel.id],
    });
    unitId = await createMinimumPackagingUnit(em, { productId: product.id, name: 'Carton', baseQuantity: 6 });
    await seedScopedValues(em, product.id, [
      {
        field: `packagingUnit:${unitId}:name`,
        scope: { level: 'channel_language', channelId: channel.id, languageCode: channel.defaultLanguage },
        value: `Skrzynia ${RUN}`,
      },
    ]);
    await completeActiveBaskets();
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    await h
      .em()
      .getConnection()
      .execute(`delete from product_packaging_unit_scope_overrides where product_id = ?`, [product.id]);
    await teardownBackendServer(h);
  });

  it("an operator naming the channel snapshots the name at the channel's default language (N2)", async () => {
    const cartWrite = (h.container.cradle as unknown as { cartWritePort: CartWritePort }).cartWritePort;
    const added = await cartWrite.addItem(
      { customer: { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID, salesChannelId: channelId } },
      { productId: product.id, quantity: 1, packagingUnitId: unitId, salesChannelId: channelId },
    );
    const line = added.items.find((i) => i.productId === product.id);
    expect(line?.packagingUnitName).toBe(`Skrzynia ${RUN}`);
  });
});
