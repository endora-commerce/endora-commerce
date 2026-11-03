import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookLinesResponse } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T058; FR-031, data-model §1) — a price
 * book is an operator's list with no channel: its product lines are labelled, ordered and
 * searched by the product's **Global** name — one admin key whatever the admin language. A
 * channel or channel × language translation is neither shown nor matched.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

describe('170 — price-book product lines by the Global name [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let drill: MinimumProductFixture;
  let bookId = '';
  const GLOBAL = `Drill X ${RUN}`;
  const VIP_PL = `Wiertarka X Pro ${RUN}`;

  const lines = async (lang: string, search: string): Promise<PriceBookLinesResponse['data']> => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-books/${bookId}/lines?lang=${lang}&search=${encodeURIComponent(search)}&page=1&pageSize=50`,
      cookies: ADMIN,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as PriceBookLinesResponse).data;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    drill = await createMinimumProduct(em, { sku: `S170-PB-${RUN}`, nameEn: GLOBAL, namePl: GLOBAL, channelIds: [vipId] });
    await seedScopedValues(em, drill.id, [
      { field: 'name', scope: { level: 'channel', channelId: vipId }, value: `Drill X Pro ${RUN}` },
      { field: 'name', scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: VIP_PL },
    ]);
    bookId = await seedPriceBookSql(em, {
      name: `Book 170 ${RUN}`,
      audience: 'everyone',
      status: 'draft',
      rows: [{ productId: drill.id, fixed: '349.0000' }],
    });
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), [drill.id]);
    await teardownBackendServer(h);
  });

  it.each(['en', 'pl'])('labels the product line by its Global name for a %s admin', async (lang) => {
    const found = await lines(lang, GLOBAL);
    expect(found.map((l) => l.labels.productName)).toEqual([GLOBAL]);
  });

  it('does not match the product by a channel × language translation', async () => {
    expect(await lines('pl', VIP_PL)).toEqual([]);
  });
});
