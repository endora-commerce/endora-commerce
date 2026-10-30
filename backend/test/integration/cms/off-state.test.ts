import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_BRAND_TOKENS } from '@endora-commerce/contracts';
import { CMS_PAGE_BUILDER_SETTING_CODES } from '@endora-commerce/mod-cms';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `cms` off-state — Constitution XVII item 6.
 *
 * The module's prior off-state coverage is two `withModuleOff` callers —
 * `_admin_surfaces/batch-sixteen-palette-off-state.test.ts`, which asserts the
 * palette action goes when the module does, and `cms/asset-reference-while-off`,
 * which is a *consumer's* question (an asset still referenced by a switched-off
 * module's rows). Neither is item 6's question, and the palette assertion is
 * deliberately not repeated here: two derivations of one claim are two answers
 * waiting to disagree.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the admin page list and an admin write. Both halves
 *    are named because a read going 503 while a write still lands is the shape
 *    an operator would not notice;
 *  * **storefront absence** — `GET /api/v1/cms/pages/by-slug`, which is what a
 *    shop's content page is rendered from, and `GET /api/v1/cms/pages/by-channel`,
 *    which is what its sitemap is built from (feature 105, FR-022). A
 *    switched-off CMS that still serves either is the operator's withdrawal
 *    being invisible on the only surface a buyer looks at, and both are a
 *    different question from the editor going 503. The listing is named
 *    separately because "the pages stop rendering" and "the shop stops
 *    advertising them" are two withdrawals, and a sitemap that kept naming URLs
 *    the shop now 404s would be the second one silently not happening;
 *  * **non-editable configuration** — the Page Builder's tablet breakpoint, an
 *    ordinary setting in the module's `cms_page_builder` group. `cms.enabled`
 *    is deliberately *not* written here: it is the module's activation
 *    control, the single exception item 6 names, and a test that wrote it
 *    while off would be driving the one switch that has to keep working;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: pages, blocks, templates and hook attachments stay, and
 *    the restored probes hold the routes to it.
 *
 * **Brand tokens** (feature 163, T022) join the probes: the admin read and
 * write and the storefront read go with the module, and come back with it
 * because the harness's restoration assertion covers every probe. With `cms`
 * off the storefront renders without `<style id="cmsb">`, so the fallbacks
 * apply. Off is non-destructive: a stored `cms_brand_tokens` row survives the
 * off/on cycle on both axes. The `open-cms-brand` palette action and the
 * `/cms/brand` nav entry arrive with the brand screen (Phase 3c); the palette's
 * off-state is `_admin_surfaces/batch-sixteen-palette-off-state.test.ts`'s
 * question, as for every other `cms` action.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator actually creates: switching the
 * CMS off from `/platform/modules` never touches the lifecycle registry.
 */
describe('cms off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const channel = { 'x-sales-channel': 'default' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    // A stored set for a channel id no channel has: never read, and nobody
    // else's, so it can be taken out again without touching real state.
    const rowId = randomUUID();
    await h.em().execute(
      `insert into cms_brand_tokens (id, sales_channel_id, tokens, version) values (?, ?, ?::jsonb, 1)`,
      [rowId, randomUUID(), JSON.stringify(DEFAULT_BRAND_TOKENS)],
    );
    try {
      await expectCmsAbsent();
      const survived = (await h.em().execute('select id from cms_brand_tokens where id = ?', [
        rowId,
      ])) as Array<{ id: string }>;
      expect(survived, 'a brand-token row must survive the off/on cycle').toHaveLength(1);
    } finally {
      await h.em().execute('delete from cms_brand_tokens where id = ?', [rowId]);
    }
  });

  // Feature 167 (T078) — the CMS slug reservation is the cms side of the language
  // prefixes; with cms off nothing reserves, and the channels' languages and their
  // derived URL languages are untouched: a channel language edit succeeds and the
  // public channel read still answers the prefixes the storefront parses.
  it('leaves channel language edits and the URL languages alone while off', async () => {
    const code = `cms-off-167-${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: admin,
      payload: {
        code,
        name: { 'en-US': 'cms off' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    expect(created.statusCode).toBe(201);
    try {
      await withModuleOff('cms', 'deactivated', async () => {
        const patched = await h.app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/sales-channels/${code}`,
          cookies: admin,
          payload: { expectedVersion: 1, languages: ['en-US', 'pl-PL'] },
        });
        expect(patched.statusCode).toBe(200);
        const identity = await h.app.inject({
          method: 'GET',
          url: '/api/v1/storefront/sales-channel',
          headers: { 'x-sales-channel': code },
        });
        expect(identity.statusCode).toBe(200);
        const data = (identity.json() as { data: { urlLanguages: Array<{ prefix: string }> } }).data;
        expect(data.urlLanguages.map((l) => l.prefix)).toEqual(['en', 'pl']);
      });
    } finally {
      await h.app.inject({ method: 'POST', url: `/api/v1/admin/sales-channels/${code}/deactivate`, cookies: admin });
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${code}`, cookies: admin });
    }
  });

  // Feature 169 (T062) — `cms.PageNavigation` is declared by `cms`: while the
  // module is off, on either axis, no descriptor offers it (the descriptor
  // route itself is the module's and answers 503), and it is back with it.
  it('offers cms.PageNavigation only while cms is on', async () => {
    const names = async (): Promise<string[]> => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/cms/page-builder/config', cookies: admin });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { components: Array<{ name: string }> } }).data.components.map((c) => c.name);
    };
    expect(await names()).toContain('cms.PageNavigation');
    for (const axis of ['deactivated', 'platform-unavailable'] as const) {
      await withModuleOff('cms', axis, async () => {
        const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/cms/page-builder/config', cookies: admin });
        expect(res.statusCode, `${axis}: ${res.body}`).toBe(503);
        expect(res.body).not.toContain('cms.PageNavigation');
      });
      expect(await names(), axis).toContain('cms.PageNavigation');
    }
  });

  async function expectCmsAbsent(): Promise<void> {
    await expectModuleAbsent(h, 'cms', {
      routes: [
        { url: '/api/v1/admin/cms/pages', cookies: admin },
        { method: 'POST', url: '/api/v1/admin/cms/pages', cookies: admin, payload: {} },
        { url: '/api/v1/cms/pages/by-slug?slug=home', headers: channel },
        { url: '/api/v1/cms/pages/by-channel', headers: channel },
        // Feature 151 — the Page Builder translation goes with the module.
        // `credentials` off and `prompt_actions` off are the other two rows of
        // its off-state table, in `page-builder-translation.test.ts`.
        { url: '/api/v1/admin/cms/page-builder/translation', cookies: admin },
        {
          method: 'POST',
          url: '/api/v1/admin/cms/page-builder/translate',
          cookies: admin,
          payload: { targetLanguage: 'en-US', sourceLanguage: null, context: 'cms', data: { root: {}, content: [] } },
        },
        // Feature 163 — brand tokens: the admin read and write, and the
        // storefront read the `<style id="cmsb">` tag is rendered from.
        { url: '/api/v1/admin/cms/brand-tokens', cookies: admin },
        {
          method: 'PUT',
          url: '/api/v1/admin/cms/brand-tokens',
          cookies: admin,
          payload: { scope: { kind: 'all' }, tokens: null, expectedVersion: 0 },
        },
        { url: '/api/v1/storefront/cms/brand-tokens', headers: channel },
        // Feature 169 (T104) — the contact form's public endpoint goes with the module. The
        // honeypot is filled, so the restored probe answers `sent` and sends nothing.
        {
          method: 'POST',
          url: '/api/v1/storefront/cms/contact-form',
          headers: channel,
          payload: { email: 'probe@example.com', message: 'probe', privacyConsent: true, website: 'probe' },
        },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: CMS_PAGE_BUILDER_SETTING_CODES.BREAKPOINT_TABLET_MIN,
        value: 700,
        cookies: admin,
      },
    });
  }
});
