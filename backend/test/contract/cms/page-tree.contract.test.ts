import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * The page tree and the breadcrumb trail
 * (`specs/163-page-builder-marketing-pages/` T079; spec US8, FR-030–FR-032;
 * research R-18; data-model §1.1, §5, §6; `contracts/storefront-and-admin-api.md` §2).
 *
 * - The parent is written by the existing `cms_page.update` Command, which
 *   refuses a self-parent, a cycle and a chain deeper than eight levels with
 *   `422 CMS_PAGE_PARENT_CYCLE`, writing and auditing nothing.
 * - The storefront trail is resolved per channel (Principle XII): an ancestor
 *   that the request's channel does not serve, published and active, is a
 *   plain-text crumb (`slug: null`).
 */
const RUN = `pb163_${randomUUID().slice(0, 8)}`;

type PageData = {
  id: string;
  version: number;
  slug: string;
  parentPageId: string | null;
  breadcrumbsVisible: boolean;
  breadcrumbsScheme: 'light' | 'muted' | 'dark';
};

describe('CMS page tree and breadcrumbs contract (feature 163, T079)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let channelCode: string;
  let otherChannel: SalesChannel;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const created: string[] = [];
  let seq = 0;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
    channelCode = channel.code;
    otherChannel = h.em().create(SalesChannel, {
      code: `${RUN}-other`.replace('_', '-'),
      name: { 'en-US': 'Tree other' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await h.em().persist(otherChannel).flush();
  });

  afterAll(async () => {
    // Children first is not needed: the parent FK sets null on delete.
    for (const id of created.reverse()) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/cms/pages/${id}`, cookies: adminCookie });
    }
    await h.em().getConnection().execute('delete from sales_channels where id = ?', [otherChannel.id]);
    await teardownBackendServer(h);
  });

  async function createPage(
    label: string,
    options: { salesChannelIds?: string[]; meta?: Record<string, { title?: string }> } = {},
  ): Promise<PageData> {
    seq += 1;
    const slug = `${RUN}-${label}-${seq}`.replace('_', '-');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Page ${label}`,
        slug,
        active: true,
        description: null,
        salesChannelIds: options.salesChannelIds ?? [channelId],
        languages: ['en-US'],
        ...(options.meta ? { meta: options.meta } : {}),
      }),
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: PageData }).data;
    created.push(data.id);
    return { ...data, slug };
  }

  async function current(id: string): Promise<PageData> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/cms/pages/${id}`, cookies: adminCookie });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: PageData }).data;
  }

  function patch(id: string, body: Record<string, unknown>) {
    return h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/pages/${id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify(body),
    });
  }

  async function setParent(id: string, parentPageId: string | null) {
    return patch(id, { parentPageId, version: (await current(id)).version });
  }

  async function publishWithContent(id: string): Promise<void> {
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data: { root: { props: {} }, content: [] }, version: (await current(id)).version }),
    });
    expect(put.statusCode).toBe(200);
    const pub = await h.app.inject({ method: 'POST', url: `/api/v1/admin/cms/pages/${id}/publish`, cookies: adminCookie });
    expect(pub.statusCode).toBe(200);
  }

  async function bySlug(slug: string, code = channelCode) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': code, 'accept-language': 'en-US' },
    });
  }

  async function auditRows(pageId: string): Promise<AuditLogEntry[]> {
    return h.em().fork().find(AuditLogEntry, { action: 'cms_page.update', objectType: 'cms_page', objectId: pageId });
  }

  function expectCycle(res: { statusCode: number; json: () => unknown }): void {
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_PAGE_PARENT_CYCLE } });
  }

  it('creates a page with no parent, visible breadcrumbs and the light scheme', async () => {
    const page = await createPage('defaults');
    expect(page).toMatchObject({ parentPageId: null, breadcrumbsVisible: true, breadcrumbsScheme: 'light' });
  });

  it('refuses the page itself as its parent, writing and auditing nothing', async () => {
    const page = await createPage('self');
    expectCycle(await setParent(page.id, page.id));
    expect(await current(page.id)).toMatchObject({ parentPageId: null, version: page.version });
    expect(await auditRows(page.id)).toHaveLength(0);
  });

  it('refuses A → B → A', async () => {
    const a = await createPage('cycle-a');
    const b = await createPage('cycle-b');
    expect((await setParent(b.id, a.id)).statusCode).toBe(200);
    expectCycle(await setParent(a.id, b.id));
    expect((await current(a.id)).parentPageId).toBeNull();
    expect(await auditRows(a.id)).toHaveLength(0);
  });

  it('accepts a chain of eight levels and refuses a ninth', async () => {
    const chain: PageData[] = [];
    for (let i = 1; i <= 9; i += 1) chain.push(await createPage(`depth-${i}`));
    for (let i = 1; i < 8; i += 1) {
      expect((await setParent(chain[i]!.id, chain[i - 1]!.id)).statusCode).toBe(200);
    }
    expectCycle(await setParent(chain[8]!.id, chain[7]!.id));

    // The subtree counts too: hanging a two-level branch under level 7 is nine.
    const branchRoot = await createPage('branch-root');
    const branchLeaf = await createPage('branch-leaf');
    expect((await setParent(branchLeaf.id, branchRoot.id)).statusCode).toBe(200);
    expectCycle(await setParent(branchRoot.id, chain[6]!.id));
    expect((await setParent(branchRoot.id, chain[5]!.id)).statusCode).toBe(200);
  });

  it('refuses a parent that does not exist', async () => {
    const page = await createPage('missing-parent');
    const res = await setParent(page.id, randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_PAGE_NOT_FOUND } });
  });

  it('clears parentPageId on the child when the parent is deleted', async () => {
    const parent = await createPage('deleted-parent');
    const child = await createPage('orphan');
    expect((await setParent(child.id, parent.id)).statusCode).toBe(200);
    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/cms/pages/${parent.id}`, cookies: adminCookie });
    expect(del.statusCode).toBe(204);
    expect((await current(child.id)).parentPageId).toBeNull();
  });

  it('lists parentPageId on the admin page list', async () => {
    const parent = await createPage('list-parent');
    const child = await createPage('list-child');
    expect((await setParent(child.id, parent.id)).statusCode).toBe(200);
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/pages?q=${encodeURIComponent(child.slug)}`,
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<{ id: string; parentPageId: string | null }> }).data;
    expect(rows.find((row) => row.id === child.id)?.parentPageId).toBe(parent.id);
  });

  // R19C (T270, deliberately changed): every crumb is named by its page name — the
  // current page's crumb always was; an ancestor's meta title is the browser title, not its crumb.
  it('resolves the trail root-first, naming an ancestor by its page name, not its meta title', async () => {
    const root = await createPage('trail-root');
    const a = await createPage('trail-a', { meta: { 'en-US': { title: 'Client zone' } } });
    const child = await createPage('trail-child');
    expect((await setParent(a.id, root.id)).statusCode).toBe(200);
    expect((await setParent(child.id, a.id)).statusCode).toBe(200);
    for (const page of [root, a, child]) await publishWithContent(page.id);

    const res = await bySlug(child.slug);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { breadcrumbs: unknown } }).data.breadcrumbs).toEqual({
      visible: true,
      scheme: 'light',
      trail: [
        { name: 'Page trail-root', slug: root.slug, path: root.slug },
        { name: 'Page trail-a', slug: a.slug, path: a.slug },
      ],
    });
  });

  it('gives slug: null for an ancestor that is not published in the channel', async () => {
    const a = await createPage('draft-parent');
    const child = await createPage('draft-child');
    expect((await setParent(child.id, a.id)).statusCode).toBe(200);
    await publishWithContent(child.id);

    const res = await bySlug(child.slug);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { breadcrumbs: { trail: unknown } } }).data.breadcrumbs.trail).toEqual([
      { name: 'Page draft-parent', slug: null, path: null },
    ]);
  });

  it('gives slug: null for an ancestor published only in another channel (Principle XII)', async () => {
    const a = await createPage('elsewhere-parent', { salesChannelIds: [otherChannel.id] });
    const child = await createPage('elsewhere-child', { salesChannelIds: [channelId, otherChannel.id] });
    expect((await setParent(child.id, a.id)).statusCode).toBe(200);
    await publishWithContent(a.id);
    await publishWithContent(child.id);

    const here = await bySlug(child.slug);
    expect(here.statusCode).toBe(200);
    expect((here.json() as { data: { breadcrumbs: { trail: unknown } } }).data.breadcrumbs.trail).toEqual([
      { name: 'Page elsewhere-parent', slug: null, path: null },
    ]);

    // The channel that does serve the parent links it.
    const there = await bySlug(child.slug, otherChannel.code);
    expect(there.statusCode).toBe(200);
    expect((there.json() as { data: { breadcrumbs: { trail: unknown } } }).data.breadcrumbs.trail).toEqual([
      { name: 'Page elsewhere-parent', slug: a.slug, path: a.slug },
    ]);
  });

  it('round-trips breadcrumbsVisible: false and the scheme, onto the storefront read', async () => {
    const page = await createPage('settings');
    const res = await patch(page.id, { breadcrumbsVisible: false, breadcrumbsScheme: 'dark', version: page.version });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { breadcrumbsVisible: false, breadcrumbsScheme: 'dark' } });
    expect(await current(page.id)).toMatchObject({ breadcrumbsVisible: false, breadcrumbsScheme: 'dark' });

    await publishWithContent(page.id);
    const read = await bySlug(page.slug);
    expect(read.statusCode).toBe(200);
    expect((read.json() as { data: { breadcrumbs: unknown } }).data.breadcrumbs).toEqual({
      visible: false,
      scheme: 'dark',
      trail: [],
    });
  });

  // R21H (T355): the trail over the first section — off by default, on the detail, the audit and the storefront read.
  it('round-trips breadcrumbsOverlay, off by default and answered on the storefront read only when on', async () => {
    const page = await createPage('overlay');
    expect(await current(page.id)).toMatchObject({ breadcrumbsOverlay: false });
    const res = await patch(page.id, { breadcrumbsOverlay: true, breadcrumbsScheme: 'dark', version: page.version });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: { breadcrumbsOverlay: true } });
    const rows = await auditRows(page.id);
    expect(rows[0]!.stateBefore).toMatchObject({ breadcrumbsOverlay: false });
    expect(rows[0]!.stateAfter).toMatchObject({ breadcrumbsOverlay: true });

    await publishWithContent(page.id);
    const read = await bySlug(page.slug);
    expect((read.json() as { data: { breadcrumbs: unknown } }).data.breadcrumbs).toEqual({
      visible: true,
      scheme: 'dark',
      overlay: true,
      trail: [],
    });
  });

  it('refuses an unknown scheme with a validation error', async () => {
    const page = await createPage('bad-scheme');
    const res = await patch(page.id, { breadcrumbsScheme: 'neon', version: page.version });
    expect(res.statusCode).toBe(400);
  });

  it('records the four fields on both sides of the cms_page.update audit entry', async () => {
    const parent = await createPage('audit-parent');
    const page = await createPage('audit');
    const res = await patch(page.id, {
      parentPageId: parent.id,
      breadcrumbsVisible: false,
      breadcrumbsScheme: 'muted',
      version: page.version,
    });
    expect(res.statusCode).toBe(200);

    const rows = await auditRows(page.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateBefore).toMatchObject({
      parentPageId: null,
      breadcrumbsVisible: true,
      breadcrumbsScheme: 'light',
      shareImageAssetId: null,
    });
    expect(rows[0]!.stateAfter).toMatchObject({
      parentPageId: parent.id,
      breadcrumbsVisible: false,
      breadcrumbsScheme: 'muted',
      shareImageAssetId: null,
    });
  });
});
