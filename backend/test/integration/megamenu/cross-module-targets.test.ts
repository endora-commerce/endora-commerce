import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Asset, Category, CmsPage } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/110-instance-repository/` T118c — `megamenu` resolves its own
 * cross-module targets.
 *
 * ## What this file is for, and why it is not one of the existing ones
 *
 * The drain replaced eight closures a composition root wrote with five published
 * ports the module resolves. Three of those eight were **asserted by nothing in
 * the tree** — measured over `backend/test/{contract,integration}/megamenu/`
 * before the change: no test resolved a `cms-page-link` at all, and no test read
 * a resolved `category-link`'s `url`. `admin-items.contract.test.ts` creates a
 * category-link item and never fetches `/by-channel`, so `categoryExists` had a
 * positive proof and `resolveCategoryUrl` and `resolveCmsPageUrl` had none.
 *
 * That is exactly the hole the two composition roots had grown into, and this
 * file is what would have shown it:
 *
 *  - production built `/c/<slug>` and the harness built `/catalog/<slug>`, a path
 *    `storefront/app/(catalog)` serves from nowhere;
 *  - production narrowed with `is_active = true and deleted_at is null` and the
 *    harness narrowed with nothing, so a deactivated category kept its menu item
 *    under test and lost it in production.
 *
 * Both are asserted below, on the composed harness, which is the only place that
 * can see whether the wiring exists at all —
 * `packages/modules/megamenu/src/backend/services/cross-module-ports.test.ts`
 * owns the mappings and composes nothing.
 *
 * ## What a red here means, measured rather than assumed
 *
 * Each of the five ports was withheld in turn — replaced in
 * `MegamenuCrossModulePorts` by a stub answering nothing, the package rebuilt,
 * this file re-run — and the answer splits in two, which is worth knowing before
 * reading a failure:
 *
 *  - `categories`, `pages`, `blocks` and `assets` red on **the admin write**,
 *    `expected 400 to be 200`, because each serves the target validator first and
 *    the validator refuses an item whose target does not resolve. So a missing
 *    read port never reaches the payload assertions.
 *  - `assetLibrary` reds on `expected '' to match /^https?:\/\//`, because it is
 *    the one port only the storefront resolver reads.
 *
 * The resolver half is therefore discriminated by the *mapping* rather than by a
 * withheld port, and the two mappings the composition roots disagreed about were
 * measured directly by restoring each root's answer:
 *
 *  - `/catalog/<slug>` (the harness's) fails the first case with
 *    `expected '/catalog/mm-live-…' to be '/c/mm-live-…'`;
 *  - dropping `liveOnly` and the `isActive` test (also the harness's) fails the
 *    second with `expected [ 'category-link', 'external-link' ] to deeply equal
 *    [ 'external-link' ]`.
 */
describe('megamenu resolves its own cross-module targets (T118c)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let channelCode: string;
  let liveCategoryId: string;
  let liveCategorySlug: string;
  let deactivatedCategoryId: string;
  let pageId: string;
  let pageSlug: string;
  let assetId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
    channelCode = channel.code;

    const em = h.em();
    const stamp = Date.now();
    liveCategorySlug = `mm-live-${stamp}`;
    pageSlug = `mm-page-${stamp}`;

    const live = em.create(Category, {
      name: { 'en-US': 'Pumps' },
      slug: liveCategorySlug,
      isActive: true,
    });
    const deactivated = em.create(Category, {
      name: { 'en-US': 'Withdrawn' },
      slug: `mm-off-${stamp}`,
      isActive: false,
    });
    const page = em.create(CmsPage, {
      path: pageSlug,
      slug: pageSlug,
      name: 'About us',
      title: { 'en-US': 'About us' },
      body: {},
      status: 'published',
    });
    const asset = em.create(Asset, {
      filename: 'tile.png',
      mimeType: 'image/png',
      kind: 'image',
      sizeBytes: '512',
      visibility: 'public',
      storageBackend: 'local',
      storageLocator: 'megamenu/tile.png',
      storageUrl: '/assets/megamenu/tile.png',
      label: 'Menu tile',
    });
    await em.persistAndFlush([live, deactivated, page, asset]);

    liveCategoryId = live.id;
    deactivatedCategoryId = deactivated.id;
    pageId = page.id;
    assetId = asset.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedBlock(): Promise<string> {
    const code = `mm-targets-${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Menu panel',
        code,
        active: true,
        salesChannelIds: [channelId],
        languages: ['en-US'],
      }),
    });
    expect(created.statusCode).toBe(201);
    const block = (created.json() as { data: { id: string; version: number } }).data;

    const content = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${block.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: { root: { props: {} }, content: [{ type: 'cms.Heading', props: { text: 'Panel' } }] },
        version: block.version,
      }),
    });
    expect(content.statusCode).toBe(200);
    return block.id;
  }

  async function publish(items: unknown[]): Promise<void> {
    const menuRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Targets ${Date.now()}-${Math.random()}` }),
    });
    expect(menuRes.statusCode).toBe(201);
    const menu = (menuRes.json() as { data: { id: string; version: number } }).data;

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ items, version: menu.version }),
    });
    // The admin write is the target **validator**'s proof: every id below has to
    // resolve through `catalogCategoryReadPort`, `cmsPageReadPort`,
    // `cmsBlockReadPort` and `assetReadPort` or this is a 400.
    expect(put.statusCode).toBe(200);

    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: channelId, language: 'en-US' }),
    });
    const activate = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: channelId, language: 'en-US' }),
    });
    expect(activate.statusCode).toBe(200);
  }

  interface ResolvedItem {
    kind: string;
    label: string;
    url?: string;
    asset?: { url: string; kind: string; label: string | null };
    block?: { code: string; language: string; content: { schemaVersion: number; data: unknown } };
  }

  async function resolveMenu(): Promise<ResolvedItem[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': channelCode },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { items: ResolvedItem[] } }).data.items;
  }

  it('resolves all four target kinds through their owners’ ports', async () => {
    const blockId = await seedBlock();
    await publish([
      {
        id: randomUUID(),
        parentId: null,
        position: 0,
        kind: 'category-link',
        labels: { 'en-US': 'Pumps' },
        target: { categoryId: liveCategoryId },
      },
      {
        id: randomUUID(),
        parentId: null,
        position: 1,
        kind: 'cms-page-link',
        labels: { 'en-US': 'About' },
        target: { pageId },
      },
      {
        id: randomUUID(),
        parentId: null,
        position: 2,
        kind: 'asset',
        labels: { 'en-US': 'Tile' },
        target: { assetId, kind: 'image' },
      },
      {
        id: randomUUID(),
        parentId: null,
        position: 3,
        kind: 'cms-block-embed',
        labels: { 'en-US': 'Panel' },
        target: { blockId, embedSide: 'right' },
      },
    ]);

    const items = await resolveMenu();
    const byKind = (kind: string): ResolvedItem =>
      items.find((i) => i.kind === kind) ?? (expect.fail(`no ${kind} item resolved`) as never);

    // `catalogCategoryReadPort` — and the storefront's own route shape. The
    // harness root answered `/catalog/<slug>` here, which nothing serves.
    expect(byKind('category-link').url).toBe(`/c/${liveCategorySlug}`);

    // `cmsPageReadPort` — the member no test in the tree exercised at all before
    // this file: there was no `cms-page-link` item anywhere under
    // `backend/test/{contract,integration}/megamenu/`.
    expect(byKind('cms-page-link').url).toBe(`/${pageSlug}`);

    // `assetReadPort` for the stored kind and the label, `assetsLibraryPort` for
    // the URL — two ports because neither carries both, and `resolveUrl` is
    // published on no port (D-223).
    expect(byKind('asset').asset).toMatchObject({ kind: 'image', label: 'Menu tile' });
    // Absolute, which is the half `AssetRecord` cannot answer: `storageUrl` is
    // the stored column and would render `/assets/megamenu/tile.png`. This is
    // the library's own answer, on the deployment's public API origin (D-223).
    expect(byKind('asset').asset?.url).toMatch(/^https?:\/\//);

    // `cmsBlockReadPort.findLocalizedById` — the port this merge request
    // publishes, and the whole reason `cms` is T118c's target here.
    expect(byKind('cms-block-embed').block).toMatchObject({
      language: 'en-US',
      content: { schemaVersion: 1 },
    });
    expect(
      (byKind('cms-block-embed').block?.content.data as { content: Array<{ type: string }> })
        .content[0]?.type,
    ).toBe('cms.Heading');
  });

  it('drops a deactivated category’s item, which the harness root did not', async () => {
    // Production's `is_active = true and deleted_at is null`, preserved as
    // `findById(id, { liveOnly: true })` plus the caller's own `isActive` test.
    // The harness's closure narrowed on neither, so this assertion is new
    // behaviour *under test* and unchanged behaviour in production — which is
    // the direction a drain has to be wrong in if it is wrong at all.
    await publish([
      {
        id: randomUUID(),
        parentId: null,
        position: 0,
        kind: 'category-link',
        labels: { 'en-US': 'Withdrawn' },
        target: { categoryId: deactivatedCategoryId },
      },
      {
        id: randomUUID(),
        parentId: null,
        position: 1,
        kind: 'external-link',
        labels: { 'en-US': 'Kept' },
        target: { url: 'https://example.com/kept' },
      },
    ]);

    const items = await resolveMenu();
    // The validator still accepted the item — an operator may deactivate a
    // category after wiring the menu, and the roots' `select 1` accepted one too
    // — so this is the *resolver* refusing, not the write.
    expect(items.map((i) => i.kind)).toEqual(['external-link']);
  });
});
