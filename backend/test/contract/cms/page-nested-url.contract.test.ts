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
 * Hierarchical page addresses (`specs/163-page-builder-marketing-pages/` R19D,
 * T280–T285).
 *
 * - A page that sets `parentPathInUrl` is served at its parent's public path
 *   plus its own slug; a page that does not — every page stored before the
 *   option — keeps its flat `/<slug>`.
 * - `by-slug` takes the whole path. The flat slug of a nested page still
 *   resolves, answering the canonical `path` for the storefront to redirect to.
 * - Paths are computed on read, per channel (Principle XII), so renaming or
 *   moving a parent moves every nested descendant with it.
 * - Two pages may not share a public path in one channel: the write that would
 *   produce the duplicate is refused with `409 CMS_SLUG_CONFLICT`, writing and
 *   auditing nothing.
 */
const RUN = `pb163n_${randomUUID().slice(0, 8)}`.replace('_', '-');

type PageData = {
  id: string;
  version: number;
  slug: string;
  parentPageId: string | null;
  parentPathInUrl: boolean;
};

type Resolved = {
  id: string;
  slug: string;
  path: string;
  content: { data: unknown };
  breadcrumbs: { trail: Array<{ name: string; slug: string | null; path: string | null }> };
};

describe('CMS nested page URLs contract (feature 163, R19D)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let channelCode: string;
  let otherChannel: SalesChannel;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
    channelCode = channel.code;
    otherChannel = h.em().create(SalesChannel, {
      code: `${RUN}-other`,
      name: { 'en-US': 'Nested other' },
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
    for (const id of created.reverse()) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/cms/pages/${id}`, cookies: adminCookie });
    }
    await h.em().getConnection().execute('delete from sales_channels where id = ?', [otherChannel.id]);
    await teardownBackendServer(h);
  });

  async function createPage(
    slug: string,
    options: { parentPageId?: string; parentPathInUrl?: boolean; salesChannelIds?: string[] } = {},
  ) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: `Page ${slug}`,
        slug,
        active: true,
        description: null,
        salesChannelIds: options.salesChannelIds ?? [channelId],
        languages: ['en-US'],
        ...(options.parentPageId ? { parentPageId: options.parentPageId } : {}),
        ...(options.parentPathInUrl !== undefined ? { parentPathInUrl: options.parentPathInUrl } : {}),
      }),
    });
    if (res.statusCode === 201) created.push((res.json() as { data: PageData }).data.id);
    return res;
  }

  async function page(slug: string, options: Parameters<typeof createPage>[1] = {}): Promise<PageData> {
    const res = await createPage(slug, options);
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: PageData }).data;
  }

  async function current(id: string): Promise<PageData> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/cms/pages/${id}`, cookies: adminCookie });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: PageData }).data;
  }

  async function patch(id: string, body: Record<string, unknown>) {
    return h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/pages/${id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ ...body, version: (await current(id)).version }),
    });
  }

  async function publish(id: string, data: unknown = { root: { props: {} }, content: [] }): Promise<void> {
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version: (await current(id)).version }),
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

  async function resolved(slug: string, code = channelCode): Promise<Resolved> {
    const res = await bySlug(slug, code);
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Resolved }).data;
  }

  /** A three-level tree whose two lower pages include their parent's path, all published. */
  async function tree(label: string) {
    const zone = await page(`${RUN}-${label}-zone`);
    const section = await page(`${RUN}-${label}-section`, { parentPageId: zone.id, parentPathInUrl: true });
    const leaf = await page(`${RUN}-${label}-leaf`, { parentPageId: section.id, parentPathInUrl: true });
    for (const p of [zone, section, leaf]) await publish(p.id);
    return { zone, section, leaf, leafPath: `${zone.slug}/${section.slug}/${leaf.slug}` };
  }

  it('keeps a page without the option at its flat slug, and says so', async () => {
    const parent = await page(`${RUN}-flat-parent`);
    const child = await page(`${RUN}-flat-child`, { parentPageId: parent.id });
    expect(child.parentPathInUrl).toBe(false);
    await publish(child.id);
    expect((await resolved(child.slug)).path).toBe(child.slug);
    expect((await bySlug(`${parent.slug}/${child.slug}`)).statusCode).toBe(404);
  });

  it('resolves a nested page by its whole path, with the path of every crumb', async () => {
    const { zone, section, leaf, leafPath } = await tree('resolve');
    const data = await resolved(leafPath);
    expect(data.id).toBe(leaf.id);
    expect(data.path).toBe(leafPath);
    expect(data.breadcrumbs.trail).toEqual([
      { name: `Page ${zone.slug}`, slug: zone.slug, path: zone.slug },
      { name: `Page ${section.slug}`, slug: section.slug, path: `${zone.slug}/${section.slug}` },
    ]);
  });

  it('still resolves the flat slug of a nested page, answering the canonical path', async () => {
    const { leaf, leafPath } = await tree('flat-alias');
    const data = await resolved(leaf.slug);
    expect(data.id).toBe(leaf.id);
    expect(data.path).toBe(leafPath);
  });

  it('moves the nested descendants when a parent is renamed — the old path stops resolving', async () => {
    const { zone, section, leaf, leafPath } = await tree('rename');
    expect((await resolved(leafPath)).id).toBe(leaf.id);
    const renamed = `${zone.slug}-renamed`;
    expect((await patch(zone.id, { slug: renamed })).statusCode).toBe(200);
    expect((await bySlug(leafPath)).statusCode).toBe(404);
    expect((await resolved(`${renamed}/${section.slug}/${leaf.slug}`)).id).toBe(leaf.id);
  });

  it('turns the option off again, back to the flat address', async () => {
    const { leaf, leafPath } = await tree('off');
    expect((await patch(leaf.id, { parentPathInUrl: false })).statusCode).toBe(200);
    expect((await bySlug(leafPath)).statusCode).toBe(404);
    expect((await resolved(leaf.slug)).path).toBe(leaf.slug);
  });

  it('refuses a flat slug equal to an existing nested path', async () => {
    const { leafPath } = await tree('dup-flat');
    const res = await createPage(leafPath);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_SLUG_CONFLICT } });
  });

  it('refuses turning the option on when the path is taken, writing and auditing nothing', async () => {
    const zone = await page(`${RUN}-dup-on-zone`);
    const leaf = await page(`${RUN}-dup-on-leaf`, { parentPageId: zone.id });
    await page(`${zone.slug}/${leaf.slug}`);
    const before = await current(leaf.id);
    const res = await patch(leaf.id, { parentPathInUrl: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_SLUG_CONFLICT } });
    expect(await current(leaf.id)).toMatchObject({ parentPathInUrl: false, version: before.version });
    const audit = await h.em().fork().find(AuditLogEntry, { action: 'cms_page.update', objectType: 'cms_page', objectId: leaf.id });
    expect(audit).toHaveLength(0);
  });

  it('refuses renaming a parent when a descendant path would collide', async () => {
    const zone = await page(`${RUN}-dup-desc-zone`);
    const leaf = await page(`${RUN}-dup-desc-leaf`, { parentPageId: zone.id, parentPathInUrl: true });
    await page(`${RUN}-dup-desc-other/${leaf.slug}`);
    const res = await patch(zone.id, { slug: `${RUN}-dup-desc-other` });
    expect(res.statusCode).toBe(409);
    expect((await current(zone.id)).slug).toBe(zone.slug);
  });

  it('records parentPathInUrl on both sides of the cms_page.update audit entry', async () => {
    const zone = await page(`${RUN}-audit-zone`);
    const leaf = await page(`${RUN}-audit-leaf`, { parentPageId: zone.id });
    expect((await patch(leaf.id, { parentPathInUrl: true })).statusCode).toBe(200);
    const rows = await h.em().fork().find(AuditLogEntry, { action: 'cms_page.update', objectType: 'cms_page', objectId: leaf.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateBefore).toMatchObject({ parentPathInUrl: false });
    expect(rows[0]!.stateAfter).toMatchObject({ parentPathInUrl: true });
  });

  it('lists the public path on the channel index', async () => {
    const { leaf, leafPath } = await tree('index');
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/by-channel',
      headers: { 'x-sales-channel': channelCode },
    });
    expect(res.statusCode).toBe(200);
    const pages = (res.json() as { data: { pages: Array<{ slug: string; path: string }> } }).data.pages;
    expect(pages.find((entry) => entry.slug === leaf.slug)?.path).toBe(leafPath);
  });

  it('rewrites a Page Builder link of kind page to the nested path', async () => {
    const { leaf, leafPath } = await tree('link');
    const linking = await page(`${RUN}-link-from`);
    await publish(linking.id, {
      root: { props: {} },
      content: [{ type: 'cms.Button', props: { id: 'b1', link: { kind: 'page', slug: leaf.slug } } }],
    });
    const data = await resolved(linking.slug);
    const content = (data.content.data as { content: Array<{ props: { link: unknown } }> }).content;
    expect(content[0]!.props.link).toEqual({ kind: 'page', slug: leafPath });
  });

  it('serves the page flat in a channel that does not serve its parent (Principle XII)', async () => {
    const zone = await page(`${RUN}-scope-zone`, { salesChannelIds: [channelId] });
    const leaf = await page(`${RUN}-scope-leaf`, {
      parentPageId: zone.id,
      parentPathInUrl: true,
      salesChannelIds: [channelId, otherChannel.id],
    });
    await publish(zone.id);
    await publish(leaf.id);
    expect((await resolved(`${zone.slug}/${leaf.slug}`)).id).toBe(leaf.id);
    expect((await resolved(leaf.slug, otherChannel.code)).path).toBe(leaf.slug);
    expect((await bySlug(`${zone.slug}/${leaf.slug}`, otherChannel.code)).statusCode).toBe(404);
  });
});
