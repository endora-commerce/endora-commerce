import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel, resolvePublicApiBaseUrl } from '@endora-commerce/platform/kernel';

/**
 * `specs/110-instance-repository/` T118c — a CMS page's asset embed resolves, and
 * it resolves **under the harness**.
 *
 * This is the assertion the drain exists for, and the defect it pins is not
 * hypothetical: `cmsAssetResolver` was a contribution point that
 * `backend/src/composition.ts` supplied and `backend/test/helpers/test-server.ts`
 * did **not**, so every CMS storefront response in this suite resolved its asset
 * embeds to `{}`. That is the failure `packages/modules/cms/src/backend/index.ts`'
 * own header already records for four late-bound setters — "the endpoint that only
 * worked in production" — one seam further on and quieter, because an empty asset
 * map is a plausible answer rather than a visibly wrong one: the response is
 * well-formed, the schema is satisfied, and `storefront-page-by-slug`'s
 * `assets: {}` reads as correct because that page embeds no asset.
 *
 * So the case below embeds one. `cms` now registers the resolver itself over
 * `assets_library`' `assetsLibraryPort`, which is a registration no composition
 * can forget; before that, this file failed on the composition it is running in
 * and passed on the one it is not.
 *
 * **The red is measured, and it discriminates.** With the pre-drain behaviour
 * simulated — `setAssetResolver(async () => null)`, which is exactly what the
 * cradle's `undefined` resolver produced under the harness — the first case fails
 * on `assets: {}` and the second one **passes**. A file that went red in both
 * would be asserting that something happened, not that the right thing did.
 *
 * It stays in `backend/test/` rather than moving into the package
 * (`specs/106-module-owned-tests/` §1): it calls `setupBackendServer`, so
 * `composesServer` is true and the file is the repository's. Its unit half — the
 * mapping and the tolerance over a stubbed port — is co-located instead, at
 * `packages/modules/cms/src/backend/services/asset-embed-resolver.test.ts`.
 */
describe('storefront CMS asset embed contract (T118c)', () => {
  let h: BackendServerHandle;
  let defaultChannel: SalesChannel;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    defaultChannel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * An `assets` row, written directly: there is no storefront upload route, and
   * the catalog gallery and blog contract tests seed the same way.
   *
   * The `url` the response carries is **not** this row's `storage_url` — it is
   * `<origin>/assets/file/<id>`, produced by the active storage adapter on every
   * read (`assetSummarySchema`' own words). Measured rather than assumed: the
   * first draft of this file asserted `storage_url` and failed on exactly that
   * difference, which is worth keeping in the record because it is the one thing
   * about this response a reader would guess wrong.
   *
   * **`<origin>` arrived with D-223.** This expectation read `/assets/file/<id>`
   * and is the place the ruling names as the correct one to see the change:
   * `assets_library` resolves the deployment's public API origin itself, so a
   * storefront on another host renders the embed instead of requesting an image
   * from itself. The origin is derived rather than spelled — a developer with
   * `PUBLIC_API_BASE_URL` or `PORT` exported would otherwise fail on their own
   * environment — and the *shape* is asserted separately below, which is the
   * half a derived expectation cannot state.
   */
  async function seedAsset(): Promise<{ id: string; url: string }> {
    const id = randomUUID();
    await h.em().getConnection().execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url,
         label, visibility, created_at, updated_at)
       values (?, 'image', 'hero.png', 'image/png', 2048, ?, 'Hero image', 'public', now(), now())`,
      [id, `https://example.test/${id}.png`],
    );
    return { id, url: `${resolvePublicApiBaseUrl()}/assets/file/${id}` };
  }

  /** A published page whose Puck tree carries one `assetId` prop. */
  async function seedPageEmbedding(assetId: string): Promise<string> {
    const id = randomUUID();
    const slug = `asset-embed-${Date.now()}`;
    const now = new Date();
    const data = {
      root: { props: {} },
      content: [{ type: 'cms.Image', props: { id: 'img-1', assetId } }],
    };

    await h.em().getConnection().execute(
      `insert into cms_pages
        (id, path, status, title, body, published_at, archived_at, created_at, updated_at,
         name, slug, active, description, meta_title, meta_description, meta_keywords,
         content, languages, version)
       values (?, ?, 'published', ?::jsonb, ?::jsonb, ?, null, ?, ?, ?, ?, true, null,
         ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, 1)`,
      [
        id,
        `${slug}-${id.slice(0, 8)}`,
        JSON.stringify({ 'en-US': `Title ${slug}` }),
        JSON.stringify({ 'en-US': '<p>Legacy body</p>' }),
        now,
        now,
        now,
        `Page ${slug}`,
        slug,
        JSON.stringify({ 'en-US': `Meta ${slug}` }),
        JSON.stringify({ 'en-US': `Description ${slug}` }),
        JSON.stringify({ 'en-US': 'cms,assets' }),
        JSON.stringify({ schema_version: 1, languages: { 'en-US': data } }),
        JSON.stringify(['en-US']),
      ],
    );
    await h.em().getConnection().execute(
      `insert into cms_page_sales_channels (page_id, sales_channel_id, slug)
       values (?, ?, ?)`,
      [id, defaultChannel.id, slug],
    );

    return slug;
  }

  async function getBySlug(slug: string) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannel.code, 'accept-language': 'en-US' },
    });
  }

  it('carries the embedded asset’s detail in the response', async () => {
    const asset = await seedAsset();
    const slug = await seedPageEmbedding(asset.id);

    const res = await getBySlug(slug);

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { assets: Record<string, unknown> };
    };

    // Keyed by the embedded id, and non-empty. This is the whole of the
    // regression: `{}` here is what the harness answered for as long as the
    // resolver was a contribution only one composition made.
    expect(Object.keys(body.data.assets)).toEqual([asset.id]);
    expect(body.data.assets[asset.id]).toEqual({
      url: asset.url,
      mimeType: 'image/png',
      filename: 'hero.png',
      label: 'Hero image',
      visibility: 'public',
    });
    // D-223, as a claim about the shape rather than about this deployment's
    // origin: a storefront is served from another host, so an embed URL that
    // starts with `/` is a request that host makes of itself.
    expect(String((body.data.assets[asset.id] as { url: string }).url)).toMatch(
      /^https?:\/\/[^/]+\/assets\/file\//,
    );
  });

  it('omits an asset the library no longer has, and keeps the page', async () => {
    // The resolver's one tolerance, at the seam that matters: a page embedding a
    // deleted asset still renders. `getAsset` throws 404 for a row that is gone
    // and the resolver answers `null`, which the storefront resolver drops from
    // the map rather than propagating.
    const slug = await seedPageEmbedding(randomUUID());

    const res = await getBySlug(slug);

    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { assets: Record<string, unknown> } }).data.assets).toEqual({});
  });
});
