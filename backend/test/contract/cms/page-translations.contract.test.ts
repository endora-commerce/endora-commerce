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
 * A CMS page's name, slug and description per language
 * (`specs/163-page-builder-marketing-pages/` R24, issue #521).
 *
 * - The page's own `name`, `slug` and `description` stay the default; a
 *   language may override any of them in `translations`, and a blank or absent
 *   override inherits.
 * - An address is unique within one channel and one language: a language slug
 *   another page already answers to in that language is refused with
 *   `409 CMS_SLUG_CONFLICT`, writing and auditing nothing.
 * - `by-slug` finds the page by its address in the requested language, else in
 *   any other, else by its own slug, and answers it in the requested language
 *   at that language's `path` — so the storefront redirects a switched language
 *   to the page's slug in it. `url` and `alternates` carry the language's path
 *   prefix (`cmsPageUrl`; feature 167 replaced R24's interim `?lang=`).
 */
const RUN = `pb163t-${randomUUID().slice(0, 8)}`;
const EN = 'en-US';
const PL = 'pl-PL';

type Translations = Record<string, { name?: string; slug?: string; description?: string }>;

type PageData = {
  id: string;
  version: number;
  name: string;
  slug: string;
  description: string | null;
  languages: string[];
  translations: Translations;
};

type Resolved = {
  id: string;
  slug: string;
  path: string;
  url: string;
  alternates: Array<{ language: string; url: string }>;
  name: string;
  language: string;
  content: { data: unknown };
  breadcrumbs: { trail: Array<{ name: string; slug: string | null; path: string | null }> };
};

describe('CMS page translations contract (feature 163, R24)', () => {
  let h: BackendServerHandle;
  let channel: SalesChannel;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    channel = h.em().create(SalesChannel, {
      code: `${RUN}-ch`,
      name: { [EN]: 'Translations channel' },
      languages: [EN, PL],
      defaultLanguage: EN,
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await h.em().persist(channel).flush();
  });

  afterAll(async () => {
    for (const id of created.reverse()) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/cms/pages/${id}`, cookies: adminCookie });
    }
    await h.em().getConnection().execute('delete from sales_channels where id = ?', [channel.id]);
    await teardownBackendServer(h);
  });

  async function createPage(
    slug: string,
    options: {
      translations?: Translations;
      languages?: string[];
      parentPageId?: string;
      parentPathInUrl?: boolean;
    } = {},
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
        description: `About ${slug}`,
        salesChannelIds: [channel.id],
        languages: options.languages ?? [EN, PL],
        ...(options.translations ? { translations: options.translations } : {}),
        ...(options.parentPageId ? { parentPageId: options.parentPageId } : {}),
        ...(options.parentPathInUrl !== undefined ? { parentPathInUrl: options.parentPathInUrl } : {}),
      }),
    });
    if (res.statusCode === 201) created.push((res.json() as { data: PageData }).data.id);
    return res;
  }

  async function page(slug: string, options: Parameters<typeof createPage>[1] = {}): Promise<PageData> {
    const res = await createPage(slug, options);
    expect(res.statusCode, res.body).toBe(201);
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
    for (const language of (await current(id)).languages) {
      const put = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/cms/pages/${id}/content/${language}`,
        headers: { 'content-type': 'application/json' },
        cookies: adminCookie,
        payload: JSON.stringify({ data, version: (await current(id)).version }),
      });
      expect(put.statusCode).toBe(200);
    }
    const pub = await h.app.inject({ method: 'POST', url: `/api/v1/admin/cms/pages/${id}/publish`, cookies: adminCookie });
    expect(pub.statusCode).toBe(200);
  }

  async function bySlug(slug: string, language: string) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=${language}`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': language },
    });
  }

  async function resolved(slug: string, language: string): Promise<Resolved> {
    const res = await bySlug(slug, language);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Resolved }).data;
  }

  /** A published page `about` whose Polish name, slug and description are its own. */
  async function about(label: string) {
    const slug = `${RUN}-${label}-about`;
    const plSlug = `${RUN}-${label}-o-nas`;
    const created = await page(slug, {
      translations: { [PL]: { name: 'O nas', slug: plSlug, description: 'Kim jesteśmy' } },
    });
    await publish(created.id);
    return { page: created, slug, plSlug };
  }

  it('stores the per-language fields and answers them on the detail and the list', async () => {
    const { page: created, plSlug } = await about('store');
    expect(created.translations).toEqual({ [PL]: { name: 'O nas', slug: plSlug, description: 'Kim jesteśmy' } });
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/cms/pages?q=${encodeURIComponent(plSlug)}`,
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: PageData[] }).data;
    expect(rows.map((row) => row.id)).toEqual([created.id]);
    expect(rows[0]!.translations[PL]?.slug).toBe(plSlug);
  });

  it('refuses an override of a language the page does not declare', async () => {
    const res = await createPage(`${RUN}-undeclared`, { languages: [EN], translations: { [PL]: { slug: `${RUN}-x` } } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE } });
  });

  it('serves a language at its own slug, name and URL, with every language as an alternate', async () => {
    const { page: created, slug, plSlug } = await about('serve');
    const pl = await resolved(plSlug, PL);
    expect(pl).toMatchObject({ id: created.id, language: PL, name: 'O nas', path: plSlug, url: `/pl/${plSlug}` });
    expect(pl.alternates).toEqual([
      { language: EN, url: `/en/${slug}` },
      { language: PL, url: `/pl/${plSlug}` },
    ]);
    const en = await resolved(slug, EN);
    expect(en).toMatchObject({ language: EN, name: `Page ${slug}`, path: slug, url: `/en/${slug}` });
  });

  it('finds the page by another language’s slug and answers the requested language’s path', async () => {
    const { page: created, slug, plSlug } = await about('switch');
    expect(await resolved(slug, PL)).toMatchObject({ id: created.id, language: PL, path: plSlug });
    expect(await resolved(plSlug, EN)).toMatchObject({ id: created.id, language: EN, path: slug });
  });

  it('still finds a page by its own slug when every language overrides it', async () => {
    const slug = `${RUN}-own`;
    const created = await page(slug, {
      translations: { [EN]: { slug: `${RUN}-own-en` }, [PL]: { slug: `${RUN}-own-pl` } },
    });
    await publish(created.id);
    expect(await resolved(slug, PL)).toMatchObject({ id: created.id, path: `${RUN}-own-pl` });
  });

  it('builds a nested path and the trail from each level’s fields in the language', async () => {
    const zone = await page(`${RUN}-services`, { translations: { [PL]: { name: 'Usługi', slug: `${RUN}-uslugi` } } });
    const leaf = await page(`${RUN}-consulting`, {
      parentPageId: zone.id,
      parentPathInUrl: true,
      translations: { [PL]: { slug: 'doradztwo' } },
    });
    await publish(zone.id);
    await publish(leaf.id);
    const pl = await resolved(`${RUN}-uslugi/doradztwo`, PL);
    expect(pl).toMatchObject({ id: leaf.id, path: `${RUN}-uslugi/doradztwo` });
    expect(pl.breadcrumbs.trail).toEqual([{ name: 'Usługi', slug: `${RUN}-uslugi`, path: `${RUN}-uslugi` }]);
    expect((await resolved(`${RUN}-services/${RUN}-consulting`, EN)).breadcrumbs.trail).toEqual([
      { name: `Page ${RUN}-services`, slug: `${RUN}-services`, path: `${RUN}-services` },
    ]);
  });

  it('rewrites a Page Builder link of kind page to the target’s path in the served language', async () => {
    const { slug, plSlug } = await about('link');
    const linking = await page(`${RUN}-link-from`);
    await publish(linking.id, {
      root: { props: {} },
      content: [{ type: 'cms.Button', props: { id: 'b1', link: { kind: 'page', slug } } }],
    });
    const content = (data: Resolved) => (data.content.data as { content: Array<{ props: { link: unknown } }> }).content;
    expect(content(await resolved(linking.slug, PL))[0]!.props.link).toEqual({ kind: 'page', slug: plSlug });
    expect(content(await resolved(linking.slug, EN))[0]!.props.link).toEqual({ kind: 'page', slug });
  });

  it('refuses a language slug another page answers to in that language, writing and auditing nothing', async () => {
    const { plSlug } = await about('dup');
    const other = await page(`${RUN}-dup-other`);
    const before = await current(other.id);
    const res = await patch(other.id, { translations: { [PL]: { slug: plSlug } } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_SLUG_CONFLICT } });
    expect(await current(other.id)).toMatchObject({ translations: {}, version: before.version });
    const audit = await h.em().fork().find(AuditLogEntry, { action: 'cms_page.update', objectType: 'cms_page', objectId: other.id });
    expect(audit).toHaveLength(0);
  });

  it('allows one slug in two languages of two pages', async () => {
    const { slug } = await about('cross');
    const other = await page(`${RUN}-cross-other`, { translations: { [PL]: { slug } } });
    expect(other.translations[PL]?.slug).toBe(slug);
  });

  it('records translations on both sides of the cms_page.update audit entry', async () => {
    const created = await page(`${RUN}-audit`);
    expect((await patch(created.id, { translations: { [PL]: { name: 'Audyt' } } })).statusCode).toBe(200);
    const rows = await h.em().fork().find(AuditLogEntry, { action: 'cms_page.update', objectType: 'cms_page', objectId: created.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateBefore).toMatchObject({ translations: {} });
    expect(rows[0]!.stateAfter).toMatchObject({ translations: { [PL]: { name: 'Audyt' } } });
  });

  it('moves the language address on a patch — the old one stops resolving', async () => {
    const { page: created, plSlug } = await about('move');
    expect((await resolved(plSlug, PL)).id).toBe(created.id);
    const moved = `${RUN}-move-kim-jestesmy`;
    expect((await patch(created.id, { translations: { [PL]: { name: 'O nas', slug: moved } } })).statusCode).toBe(200);
    expect((await bySlug(plSlug, PL)).statusCode).toBe(404);
    expect((await resolved(moved, PL)).path).toBe(moved);
  });

  it('keeps an override of a removed language stored, and stops it counting', async () => {
    const { page: created, slug, plSlug } = await about('drop');
    expect((await patch(created.id, { languages: [EN] })).statusCode).toBe(200);
    expect((await current(created.id)).translations[PL]?.slug).toBe(plSlug);
    expect((await resolved(slug, PL)).language).toBe(EN);
    expect((await bySlug(plSlug, PL)).statusCode).toBe(404);
  });

  it('lists every language URL of a page on the channel index', async () => {
    const { slug, plSlug } = await about('index');
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/pages/by-channel',
      headers: { 'x-sales-channel': channel.code },
    });
    expect(res.statusCode).toBe(200);
    const pages = (res.json() as {
      data: { pages: Array<{ slug: string; path: string; url: string; alternates: Array<{ language: string; url: string }> }> };
    }).data.pages;
    expect(pages.find((entry) => entry.slug === slug)).toMatchObject({
      path: slug,
      url: `/en/${slug}`,
      alternates: [
        { language: EN, url: `/en/${slug}` },
        { language: PL, url: `/pl/${plSlug}` },
      ],
    });
  });
});
