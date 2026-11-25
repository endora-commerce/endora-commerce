import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Category } from '../../helpers/package-entities.js';
import { seedOtherTestCustomer } from '../../helpers/seed-organizations.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/168-megamenu-navigation-bar/` (issue #522) — the navigation bar over
 * HTTP: tabs with a presentation, groups, category trees expanded from the
 * catalogue, labels inherited from targets, page links in the served
 * language, audiences, and one audit entry per write.
 *
 * Its own sales channel (default `pl-PL`, also `en-US`) so the page and
 * category URLs it asserts are its own.
 */
const RUN = `mm168-${Date.now()}`;
const PL = 'pl-PL';
const EN = 'en-US';

type Resolved = {
  id: string;
  kind: string;
  label: string;
  url?: string;
  presentation?: string;
  alignment?: string;
  children: Resolved[];
};

describe('megamenu navigation bar contract (feature 168)', () => {
  let h: BackendServerHandle;
  let channel: SalesChannel;
  let tools: { id: string };
  let drills: { id: string };
  let saws: { id: string };
  let pageId: string;
  let groupId: string;
  let menuId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function admin(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
    return h.app.inject({
      method,
      url,
      cookies: adminCookie,
      ...(payload !== undefined
        ? { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) }
        : {}),
    });
  }

  async function menuVersion(): Promise<number> {
    return ((await admin('GET', `/api/v1/admin/megamenu/menus/${menuId}`)).json() as { data: { version: number } }).data
      .version;
  }

  async function putItems(items: unknown[]) {
    return admin('PUT', `/api/v1/admin/megamenu/menus/${menuId}/items`, { items, version: await menuVersion() });
  }

  async function storefront(language: string, cookie?: string) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/megamenu/by-channel?language=${language}`,
      headers: { 'x-sales-channel': channel.code },
      ...(cookie ? { cookies: { b2b_session: cookie } } : {}),
    });
  }

  async function tabs(language: string, cookie?: string): Promise<Resolved[]> {
    const res = await storefront(language, cookie);
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { items: Resolved[] } }).data.items;
  }

  const labelsOf = (items: Resolved[]): unknown[] =>
    items.map((item) => (item.children.length > 0 ? [item.label, labelsOf(item.children)] : item.label));

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await seedOtherTestCustomer(em);

    channel = em.create(SalesChannel, {
      code: `${RUN}-ch`,
      name: { [PL]: 'Kanał 168' },
      languages: [PL, EN],
      defaultLanguage: PL,
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    tools = em.create(Category, { name: { [PL]: 'Narzędzia', [EN]: 'Tools' }, slug: `${RUN}-tools`, sortOrder: 0, isActive: true });
    await em.persist([channel, tools]).flush();
    drills = em.create(Category, {
      name: { [PL]: 'Wiertarki', [EN]: 'Drills' },
      slug: `${RUN}-drills`,
      parentCategoryId: tools.id,
      sortOrder: 1,
      isActive: true,
    });
    saws = em.create(Category, {
      name: { [PL]: 'Piły', [EN]: 'Saws' },
      slug: `${RUN}-saws`,
      parentCategoryId: tools.id,
      sortOrder: 0,
      isActive: true,
    });
    await em.persist([drills, saws]).flush();

    // Both test organisations shop on this channel; the first is in the group.
    await em.getConnection().execute(
      `insert into sales_channel_organizations (sales_channel_id, organization_id) values (?, ?), (?, ?)
       on conflict do nothing`,
      [channel.id, TEST_ORGANIZATION_ID, channel.id, OTHER_TEST_ORGANIZATION_ID],
    );
    groupId = randomUUID();
    await em.getConnection().execute(
      `insert into customer_groups (id, code, name, created_at, updated_at) values (?, ?, 'Dystrybutorzy', now(), now())`,
      [groupId, `${RUN}-dist`],
    );
    await em
      .getConnection()
      .execute(`update organizations set customer_group_id = ? where id = ?`, [groupId, TEST_ORGANIZATION_ID]);

    const page = await admin('POST', '/api/v1/admin/cms/pages', {
      name: 'O nas',
      slug: `${RUN}-o-nas`,
      salesChannelIds: [channel.id],
      languages: [PL, EN],
      translations: { [EN]: { name: 'About us', slug: `${RUN}-about-us` } },
    });
    expect(page.statusCode).toBe(201);
    pageId = (page.json() as { data: { id: string } }).data.id;

    const menu = await admin('POST', '/api/v1/admin/megamenu/menus', { name: `${RUN} menu` });
    expect(menu.statusCode).toBe(201);
    menuId = (menu.json() as { data: { id: string } }).data.id;
    for (const language of [PL, EN]) {
      await admin('POST', `/api/v1/admin/megamenu/menus/${menuId}/bindings`, { salesChannelId: channel.id, language });
    }
  });

  afterAll(async () => {
    const conn = h.em().getConnection();
    await conn.execute(`update organizations set customer_group_id = null where id = ?`, [TEST_ORGANIZATION_ID]);
    await conn.execute(`delete from megamenus where id = ?`, [menuId]);
    await conn.execute(`delete from customer_groups where id = ?`, [groupId]);
    await teardownBackendServer(h);
  });

  it('resolves tabs with their presentation, a category tree, inherited labels and page links per language', async () => {
    const catalog = randomUUID();
    const put = await putItems([
      { id: catalog, parentId: null, position: 0, presentation: 'catalog', kind: 'group', labels: { [PL]: 'Wszystkie kategorie', [EN]: 'All categories' }, target: {} },
      { parentId: catalog, position: 0, kind: 'category-tree', labels: {}, target: { rootCategoryId: null, depth: 2 } },
      { parentId: null, position: 1, presentation: 'link', kind: 'cms-page-link', labels: {}, target: { pageId } },
      { parentId: null, position: 2, presentation: 'link', alignment: 'end', kind: 'button', labels: { [PL]: 'Szybkie zamówienie' }, target: { url: '/quick-order', variant: 'primary' } },
    ]);
    expect(put.statusCode).toBe(200);
    for (const language of [PL, EN]) {
      const activate = await admin('POST', `/api/v1/admin/megamenu/menus/${menuId}/activate`, {
        salesChannelId: channel.id,
        language,
      });
      expect(activate.statusCode).toBe(200);
    }

    const pl = await tabs(PL);
    expect(pl.map((tab) => [tab.kind, tab.presentation, tab.alignment])).toEqual([
      ['group', 'catalog', 'start'],
      ['cms-page-link', 'link', 'start'],
      ['button', 'link', 'end'],
    ]);
    // The tree is the catalogue's, in its order, from one item — and other
    // tests' categories may sit beside ours at the top level.
    const ours = pl[0]!.children.find((node) => node.url === `/c/${RUN}-tools`);
    expect(ours).toMatchObject({ kind: 'category-link', label: 'Narzędzia', id: expect.stringContaining(':') });
    expect(labelsOf(ours!.children)).toEqual(['Piły', 'Wiertarki']);
    expect(pl[1]).toMatchObject({ label: 'O nas', url: `/${RUN}-o-nas` });

    const en = await tabs(EN);
    expect(en[1]).toMatchObject({ label: 'About us', url: `/${RUN}-about-us` });
    expect(en[0]!.children.find((node) => node.url === `/c/${RUN}-tools`)?.label).toBe('Tools');
  });

  it('follows the catalogue: a deactivated category leaves the tree without a menu edit', async () => {
    await h.em().getConnection().execute(`update categories set is_active = false where id = ?`, [saws.id]);
    try {
      // The read-through cache is the module's; a catalogue write reaches the
      // menu within its lifetime (FR-014), so drop it to read the change now.
      await h.app.inject({ method: 'POST', url: `/api/v1/admin/megamenu/menus/${menuId}/deactivate`, cookies: adminCookie, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ salesChannelId: channel.id, language: PL }) });
      await admin('POST', `/api/v1/admin/megamenu/menus/${menuId}/activate`, { salesChannelId: channel.id, language: PL });
      const ours = (await tabs(PL))[0]!.children.find((node) => node.url === `/c/${RUN}-tools`);
      expect(labelsOf(ours!.children)).toEqual(['Wiertarki']);
    } finally {
      await h.em().getConnection().execute(`update categories set is_active = true where id = ?`, [saws.id]);
    }
  });

  it('refuses a media tab, a link tab with children and an audience naming a missing group', async () => {
    const tab = randomUUID();
    const cases: Array<[unknown[], string]> = [
      [[{ parentId: null, position: 0, presentation: 'mega', kind: 'cms-block-embed', labels: {}, target: { blockId: randomUUID(), embedSide: 'right' } }], 'MEGAMENU_KIND_NOT_ALLOWED_AS_TAB'],
      [
        [
          { id: tab, parentId: null, position: 0, presentation: 'link', kind: 'external-link', labels: { [PL]: 'Tab' }, target: { url: 'https://example.com' } },
          { parentId: tab, position: 0, kind: 'external-link', labels: { [PL]: 'Child' }, target: { url: 'https://example.com/c' } },
        ],
        'MEGAMENU_LINK_TAB_INVALID',
      ],
      [[{ parentId: null, position: 0, presentation: 'link', kind: 'external-link', labels: { [PL]: 'Tab' }, target: { url: 'https://example.com' }, audience: { kind: 'customer_groups', customerGroupIds: [randomUUID()] } }], 'MEGAMENU_TARGET_OUT_OF_SCOPE'],
      [[{ parentId: null, position: 0, presentation: 'link', kind: 'external-link', labels: {}, target: { url: 'https://example.com' } }], 'MEGAMENU_LABEL_REQUIRED'],
    ];
    for (const [items, code] of cases) {
      const res = await putItems(items);
      expect(res.statusCode, code).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(code);
    }
  });

  it('answers each visitor the items of their audience and nothing of the rest', async () => {
    const account = randomUUID();
    const put = await putItems([
      { parentId: null, position: 0, presentation: 'link', kind: 'external-link', labels: { [PL]: 'Dla wszystkich' }, target: { url: 'https://example.com/all' } },
      { parentId: null, position: 1, presentation: 'link', kind: 'external-link', labels: { [PL]: 'Załóż konto' }, target: { url: 'https://example.com/register' }, audience: { kind: 'guests' } },
      { parentId: null, position: 2, presentation: 'link', kind: 'external-link', labels: { [PL]: 'Moje cenniki' }, target: { url: 'https://example.com/prices' }, audience: { kind: 'signed_in' } },
      { id: account, parentId: null, position: 3, presentation: 'dropdown', kind: 'group', labels: { [PL]: 'Strefa partnera' }, target: {}, audience: { kind: 'customer_groups', customerGroupIds: [groupId] } },
      { parentId: account, position: 0, kind: 'external-link', labels: { [PL]: 'Portal' }, target: { url: 'https://example.com/portal' } },
    ]);
    expect(put.statusCode).toBe(200);

    const guest = await storefront(PL);
    expect(labelsOf((guest.json() as { data: { items: Resolved[] } }).data.items)).toEqual(['Dla wszystkich', 'Załóż konto']);
    expect(guest.headers['cache-control'] ?? '').not.toContain('private');
    expect(guest.body).not.toContain('Strefa partnera');
    expect(guest.body).not.toContain(groupId);
    expect(guest.body).not.toContain('audience');

    const outsider = await storefront(PL, 'stub-customer-session-other-org');
    expect(labelsOf((outsider.json() as { data: { items: Resolved[] } }).data.items)).toEqual([
      'Dla wszystkich',
      'Moje cenniki',
    ]);
    expect(outsider.headers['cache-control']).toBe('private, no-store');

    const member = await storefront(PL, 'stub-customer-session');
    expect(labelsOf((member.json() as { data: { items: Resolved[] } }).data.items)).toEqual([
      'Dla wszystkich',
      'Moje cenniki',
      ['Strefa partnera', ['Portal']],
    ]);
  });

  it('keeps a tab whose click follows its link, and answers it on the tab alone (feature 168 review)', async () => {
    const tools = randomUUID();
    const put = await putItems([
      { id: tools, parentId: null, position: 0, presentation: 'mega', clickNavigates: true, kind: 'category-link', labels: {}, target: { categoryId: drills.id } },
      { parentId: tools, position: 0, kind: 'external-link', labels: { [PL]: 'Poradnik' }, target: { url: 'https://example.com/guide' } },
    ]);
    expect(put.statusCode).toBe(200);
    const detail = (put.json() as { data: { items: Array<{ id: string; clickNavigates?: boolean }> } }).data.items;
    expect(detail.find((item) => item.id === tools)?.clickNavigates).toBe(true);
    const [tab] = await tabs(PL);
    expect(tab).toMatchObject({ url: `/c/${RUN}-drills`, presentation: 'mega', clickNavigates: true });
    expect(tab!.children[0]).not.toHaveProperty('clickNavigates');
  });

  it('records one audit entry per write, with the tree in it', async () => {
    const before = (await h.em().getConnection().execute(
      `select count(*)::int as n from audit_log_entries where object_type = 'megamenu' and object_id = ?`,
      [menuId],
    )) as Array<{ n: number }>;
    const put = await putItems([
      { parentId: null, position: 0, presentation: 'link', kind: 'external-link', labels: { [PL]: 'Audyt' }, target: { url: 'https://example.com' }, audience: { kind: 'signed_in' } },
    ]);
    expect(put.statusCode).toBe(200);
    const rows = (await h.em().getConnection().execute(
      `select action, state_after from audit_log_entries where object_type = 'megamenu' and object_id = ?
        order by acted_at desc`,
      [menuId],
    )) as Array<{ action: string; state_after: { items: Array<{ presentation: string; audience: unknown }> } }>;
    expect(rows.length).toBe(before[0]!.n + 1);
    expect(rows[0]).toMatchObject({
      action: 'megamenu.items.set',
      state_after: { items: [{ presentation: 'link', audience: { kind: 'signed_in' } }] },
    });
  });
});
