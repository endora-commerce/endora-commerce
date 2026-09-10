import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  FeedRunIssue,
  PriceList,
  PriceListPriceBracket,
  PriceListProduct,
} from '../../helpers/package-entities.js';
import { SalesChannel, resolvePublicApiBaseUrl } from '@endora-commerce/platform/kernel';
import { setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';

/**
 * What a product feed publishes for a gallery image, and what it must not.
 *
 * Two rules, one seam. The URL is **absolute** — D-223, at the site where the
 * two composition roots disagreed about what a feed *contains*. And only a
 * **live, public** asset is published at all — FR-043, which was the root
 * closure's `findByIds(ids, { liveOnly: true })` plus its
 * `visibility === 'public'` filter and is now
 * `assetReadPort.resolvePublicUrls` (`specs/110-instance-repository/` T118c).
 *
 * The second rule was asserted by **nothing** before this file's third case,
 * measured on `master`: the only feed test in the tree carrying an image at all
 * is the first case below, and its asset is public and live. A drain that
 * dropped either filter would have left all 314 `product_feeds` tests green
 * while a private product photo, or one an operator had deleted, went into a
 * document Google fetches from its own network.
 *
 * `productFeedsBridge.resolvePublicImageUrls` turned an asset id into a URL, and
 * it did it differently in the two roots: `composition.ts` rebased a relative
 * URL onto `configuredPublicApiBaseUrl()` and emitted nothing when no origin was
 * configured, while `test-server.ts` published a URL **only** when it already
 * began `http` and silently dropped every other one. On a local-filesystem
 * deployment with a blank `assets.local.public_url_base` — the shipped default —
 * the same catalogue produced a feed with images under one root and without them
 * under the other, and no test in the tree could see it, because the seeded
 * catalogue of the only generation test carries no images at all.
 *
 * So this one attaches one. `assets_library` resolves the origin itself now, and
 * both roots pass its answer through unchanged.
 *
 * The URL matters to a consumer this platform never talks to: Google fetches a
 * feed from its own network days after it was written, so `/assets/file/<id>` is
 * not a slightly worse URL — it is no URL at all.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const PUBLISHING_STATUSES = ['completed', 'completed_with_warnings'];

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('product feed image URLs [integration]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let retailChannelId: string;
  let assetId: string;
  let privateAssetId: string;
  let deletedAssetId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    retailChannelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    // A real upload: the bytes go through the active adapter and the row records
    // the backend that holds them, which is what `resolveUrl` dispatches on.
    const detail = await h.assetsLibrary.service.upload({
      filename: 'hero.png',
      declaredMime: 'image/png',
      stream: Readable.from([TINY_PNG]),
      declaredSize: TINY_PNG.length,
      folderId: null,
      label: 'Hero',
      visibility: 'public',
    });
    assetId = detail.id;

    // Two assets that must never reach the document, one per filter, each on
    // its own product so that the reason recorded against it is unambiguous.
    const privateAsset = await h.assetsLibrary.service.upload({
      filename: 'not-for-google.png',
      declaredMime: 'image/png',
      stream: Readable.from([TINY_PNG]),
      declaredSize: TINY_PNG.length,
      folderId: null,
      label: 'Private',
      visibility: 'private',
    });
    privateAssetId = privateAsset.id;

    const deletedAsset = await h.assetsLibrary.service.upload({
      filename: 'withdrawn.png',
      declaredMime: 'image/png',
      stream: Readable.from([TINY_PNG]),
      declaredSize: TINY_PNG.length,
      folderId: null,
      label: 'Withdrawn',
      visibility: 'public',
    });
    deletedAssetId = deletedAsset.id;
    // Directly, not through `softDelete`: the gallery row below is exactly the
    // reference the library refuses a delete for, and what this case is about
    // is a row that is already gone — a purge window that has not run yet, or a
    // delete taken before the product was assigned.
    await em
      .getConnection()
      .execute('update assets set deleted_at = now() where id = ?', [deletedAssetId]);

    for (const [productId, id] of [
      [SEED_PRODUCT_101_ID, assetId],
      [SEED_PRODUCT_102_ID, privateAssetId],
      [SEED_PRODUCT_103_ID, deletedAssetId],
    ] as const) {
      await em
        .getConnection()
        .execute(
          `insert into gallery_items (id, product_id, asset_id, position, created_at, updated_at)
           values (?, ?, ?, 0, now(), now())`,
          [randomUUID(), productId, id],
        );
    }

    // Priced, or the item is skipped as `missing_required_field` and its image
    // never reaches the document — an absence that would prove nothing. All
    // three seeded products, not only the one carrying the image: two unpriced
    // siblings put the run over `skip_threshold_exceeded`, which fails it before
    // an artefact is published (measured, on the first draft of this file).
    const list = em.create(PriceList, {
      code: 'feed_image_default',
      name: 'Feed image default list',
      currency: 'PLN',
      type: 'base',
      status: 'active',
      applicationRule: { kind: 'all' },
      modifiedAt: new Date(),
    });
    await em.persistAndFlush(list);
    const priced = [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID];
    for (const productId of priced) {
      em.create(PriceListProduct, { priceListId: list.id, productId });
    }
    await em.flush();
    for (const productId of priced) {
      em.create(PriceListPriceBracket, {
        priceListId: list.id,
        productId,
        currencyCode: 'PLN',
        minQuantity: 1,
        amount: '100.0000',
      });
    }
    await em.flush();

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('publishes the gallery image on an absolute URL', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: 'Image feed',
        slug: `feed-image-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: retailChannelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    const feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;

    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(PUBLISHING_STATUSES).toContain(run.status);

    const artefact = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/product-feeds/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(artefact.statusCode).toBe(200);

    // The whole assertion, in two halves. The URL is there — the harness used to
    // drop it outright — and it names an origin, which is what a feed reader on
    // another network needs.
    expect(artefact.body).toContain(`${resolvePublicApiBaseUrl()}/assets/file/${assetId}`);
    expect(artefact.body).not.toContain(`>/assets/file/${assetId}`);
  });

  it('publishes neither a private image nor one whose asset is deleted (FR-043)', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: 'Image visibility feed',
        slug: `feed-image-vis-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: retailChannelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    const feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;

    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(PUBLISHING_STATUSES).toContain(run.status);

    const artefact = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/product-feeds/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(artefact.statusCode).toBe(200);

    // The rule. A private asset resolves to a *signed* URL that expires, and a
    // deleted one to a URL for bytes that are on their way out; a feed reader
    // fetches days later, so neither is a slightly worse link — both are
    // links that break in a shop window nobody is watching.
    expect(artefact.body).not.toContain(privateAssetId);
    expect(artefact.body).not.toContain(deletedAssetId);
    // …and the control that makes the two absences mean something. Both
    // products carry a gallery row, so the pipeline saw an image and *dropped*
    // it: `private_image_asset` is the reason it records for a gallery it may
    // not publish, as against `missing_image` for a product that has none.
    // Without this, a wiring that never read the gallery at all would pass.
    const issues = await h.em().find(FeedRunIssue, { feedRunId: run.id });
    const withheld = issues.filter((issue) => issue.reason === 'private_image_asset');
    expect(withheld.map((issue) => issue.productId).sort()).toEqual(
      [SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID].sort(),
    );
  });
});
