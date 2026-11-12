import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `seo` off-state — Constitution XVII item 6.
 *
 * The module's prior off-state coverage is
 * `_admin_surfaces/batch-eight-palette-off-state.test.ts`, which asserts that a
 * module declaring no palette action advertises none while off. That is
 * feature 091's question; item 6's are here, and the palette assertion is not
 * repeated.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the admin per-channel sitemap listing and a
 *    regeneration write. Both halves are named because a listing that keeps
 *    answering renders a screen an operator can believe is live, while a write
 *    that lands republishes a document for a capability they withdrew;
 *  * **storefront absence** — `GET /api/v1/catalog/sitemap.xml`, an ordinary
 *    harness probe declared `successBody: 'non-json'` because it answers XML
 *    (issue #102; it was hand-asserted beside the harness until then);
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: generated sitemaps and every per-entity meta override
 *    stay, and the restored probes hold the routes to it;
 *  * **non-editable configuration** — `seo.default_robots`
 *    (`specs/144-seo-search-engine-robots/`, FR-032), in the third test below
 *    and not through the harness's `settingWrite`: that probe sends a body the
 *    settings API refuses for its shape whatever the module's state, so a
 *    refusal there would not be the off state's. The third test sends a write
 *    the API accepts while the module is on and names the code it is refused
 *    with while off. `seo.robots_txt_custom` and `seo.llms_txt_additional` are
 *    held the same way in the cases after it. `seo.enabled` is the module's activation control — the single
 *    exception — and is driven by nothing here.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator creates: withdrawing sitemap
 * publication from `/platform/modules` never touches the lifecycle registry.
 */
describe('seo off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const channel = { 'x-sales-channel': 'default' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // The crawler-file preview asks a channel's storefront, at the address the
  // channel is configured with. The harness loads `backend/.env`, whose
  // `STOREFRONT_BASE_URL` would be that address; emptied, no channel here has
  // one, so the probe below answers `address-unknown` while the module is on
  // and no request leaves the process in any phase.
  beforeEach(() => {
    vi.stubEnv('STOREFRONT_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is absent from every admin surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'seo', {
      routes: [
        { url: '/api/v1/admin/seo/sitemap', cookies: admin },
        // The storefront's question about a channel's default robots. Refused
        // like any other route of an absent module: the storefront reads
        // `MODULE_DISABLED` as "this feature does not exist" and applies no
        // policy, which is a different answer from "no restriction" at `200`.
        { url: '/api/v1/storefront/seo/robots-policy', headers: channel },
        // What the storefront builds `robots.txt` from. `MODULE_DISABLED` is
        // what makes it serve the system-generated rules alone; any other
        // failure would make it answer `503` or keep an earlier text.
        { url: '/api/v1/storefront/seo/crawler-files', headers: channel },
        // The preview beside *Custom robots.txt instructions* on the Settings
        // screen (`specs/144-seo-search-engine-robots/`, FR-034, FR-038). The
        // row it sits on stays visible and read-only while the module is off;
        // the preview must not — and this is the half of that the server
        // holds: the endpoint refuses, so a stale tab cannot go on previewing
        // a file the module no longer shapes, and the backend stops asking
        // the storefront on anybody's behalf.
        {
          url: '/api/v1/admin/seo/crawler-files/preview?file=robots&salesChannelCode=default',
          cookies: admin,
        },
        // …and the one beside *Additional llms.txt content* (FR-044).
        {
          url: '/api/v1/admin/seo/crawler-files/preview?file=llms&salesChannelCode=default',
          cookies: admin,
        },
        {
          method: 'POST',
          url: '/api/v1/admin/seo/sitemap/default/regenerate',
          cookies: admin,
          payload: {},
        },
        // The storefront sitemap answers `application/xml` on every path it
        // takes, its own no-channel 503 included, so it is declared non-JSON
        // (issue #102): while on it is held to answering XML rather than any
        // JSON envelope, and while off to the platform's `MODULE_DISABLED`
        // envelope — which is what tells this 503 apart from the empty
        // `<urlset/>` one a request without a channel gets.
        { url: '/api/v1/catalog/sitemap.xml', headers: channel, successBody: 'non-json' },
      ],
      adminPresence: { cookies: admin },
    });
  });

  /**
   * *Default robots* while the module is off, and after
   * (`specs/144-seo-search-engine-robots/`, FR-030, FR-032, FR-034).
   *
   * The deactivated-while-platform-available case, because it is the one an
   * operator creates. Four things are held, and the order matters: the value is
   * stored and served first, so that every later assertion is about a module
   * that had something to withdraw.
   *
   *  1. the storefront's endpoint stops answering the policy — a `503`
   *     `MODULE_DISABLED`, not a `200` saying "no restriction";
   *  2. the setting is reported `editable: false`, and a write and a reset are
   *     both refused with the code that says why;
   *  3. the stored value survives all of that untouched;
   *  4. switching the module back on serves the stored value again, with no
   *     write in between.
   */
  it('withdraws the default robots policy while off, keeps the stored value, and serves it again after', async () => {
    const SETTING = '/api/v1/admin/settings/seo.default_robots';
    const policy = async () =>
      h.app.inject({ method: 'GET', url: '/api/v1/storefront/seo/robots-policy', headers: channel });
    /** The setting as the Settings screen reads it: editability, and what is stored. */
    const detail = async () => {
      const body = (await h.app.inject({ method: 'GET', url: SETTING, cookies: admin })).json() as {
        editable: boolean;
        globalValue: unknown;
        valuesByChannel: { salesChannelCode: string; value: unknown; updatedAt: string }[];
      };
      return {
        editable: body.editable,
        values: { global: body.globalValue, byChannel: body.valuesByChannel },
      };
    };

    const stored = await h.app.inject({
      method: 'PUT',
      url: `${SETTING}/value`,
      cookies: admin,
      payload: { scope: 'subset', salesChannelCodes: ['default'], value: 'NOINDEX, NOFOLLOW' },
    });
    expect(stored.statusCode, stored.body).toBe(200);

    try {
      // Positive control.
      const on = await policy();
      expect(on.statusCode).toBe(200);
      expect(on.json()).toEqual({ data: { index: false, follow: false } });
      expect((await detail()).editable).toBe(true);
      const valuesWhileOn = (await detail()).values;
      expect(valuesWhileOn.global).toBeNull();
      expect(valuesWhileOn.byChannel).toEqual([
        expect.objectContaining({ salesChannelCode: 'default', value: 'NOINDEX, NOFOLLOW' }),
      ]);

      await withModuleOff('seo', 'deactivated', async () => {
        const off = await policy();
        expect(off.statusCode, 'the policy endpoint must refuse while seo is off').toBe(503);
        expect((off.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');

        const whileOff = await detail();
        expect(whileOff.editable, 'the setting must be read-only while seo is off').toBe(false);
        expect(whileOff.values, 'the stored value must still be shown').toEqual(valuesWhileOn);

        const write = await h.app.inject({
          method: 'PUT',
          url: `${SETTING}/value`,
          cookies: admin,
          payload: { scope: 'subset', salesChannelCodes: ['default'], value: 'INDEX, FOLLOW' },
        });
        expect(write.statusCode).toBe(400);
        expect((write.json() as { error: { code: string } }).error.code).toBe(
          'MODULE_SETTING_READ_ONLY',
        );

        const reset = await h.app.inject({
          method: 'DELETE',
          url: `${SETTING}/values?salesChannelCodes=default`,
          cookies: admin,
        });
        expect(reset.statusCode).toBe(400);
        expect((reset.json() as { error: { code: string } }).error.code).toBe(
          'MODULE_SETTING_READ_ONLY',
        );

        expect((await detail()).values, 'a refused write must change nothing').toEqual(
          valuesWhileOn,
        );
      });

      const back = await policy();
      expect(back.statusCode).toBe(200);
      expect(back.json(), 'the stored value must be served again, unchanged').toEqual({
        data: { index: false, follow: false },
      });
      expect((await detail()).editable).toBe(true);
    } finally {
      await h.app.inject({
        method: 'DELETE',
        url: `${SETTING}/values?salesChannelCodes=default`,
        cookies: admin,
      });
    }
  });

  /**
   * *Custom robots.txt instructions* while the module is off, and after
   * (`specs/144-seo-search-engine-robots/`, FR-030 – FR-032, FR-034).
   *
   * Same shape as the test above, for the text. What differs is what the
   * refusal means to its reader: the storefront takes `MODULE_DISABLED` as
   * "serve the system-generated rules alone" — the operator's text is
   * withdrawn with the module, and `robots.txt` itself never is (FR-031).
   */
  it.each([
    // The storefront takes the refusal as "serve the system-generated rules alone"…
    { code: 'seo.robots_txt_custom', member: 'robotsTxtCustom' },
    // …and as "there is no llms.txt" (FR-030): the file goes with the module.
    { code: 'seo.llms_txt_additional', member: 'llmsTxtAdditional' },
  ] as const)('withdraws $code while off, keeps the stored text, and serves it again after', async ({ code, member }) => {
    const SETTING = `/api/v1/admin/settings/${code}`;
    const TEXT = 'User-agent: GPTBot\nDisallow: /\n';
    const files = async () =>
      h.app.inject({ method: 'GET', url: '/api/v1/storefront/seo/crawler-files', headers: channel });
    const detail = async () => {
      const body = (await h.app.inject({ method: 'GET', url: SETTING, cookies: admin })).json() as {
        editable: boolean;
        multiline?: boolean;
        globalValue: unknown;
        valuesByChannel: { salesChannelCode: string; value: unknown }[];
      };
      return {
        editable: body.editable,
        multiline: body.multiline,
        values: {
          global: body.globalValue,
          byChannel: body.valuesByChannel.map(({ salesChannelCode, value }) => ({
            salesChannelCode,
            value,
          })),
        },
      };
    };

    const stored = await h.app.inject({
      method: 'PUT',
      url: `${SETTING}/value`,
      cookies: admin,
      payload: { scope: 'subset', salesChannelCodes: ['default'], value: TEXT },
    });
    expect(stored.statusCode, stored.body).toBe(200);

    try {
      // Positive control.
      const on = await files();
      expect(on.statusCode).toBe(200);
      expect((on.json() as { data: Record<string, string> }).data[member]).toBe(TEXT);
      const whileOn = await detail();
      expect(whileOn.editable).toBe(true);
      expect(whileOn.multiline, 'the Settings screen must offer a multi-line field').toBe(true);
      expect(whileOn.values).toEqual({
        global: null,
        byChannel: [{ salesChannelCode: 'default', value: TEXT }],
      });

      await withModuleOff('seo', 'deactivated', async () => {
        const off = await files();
        expect(off.statusCode, 'the crawler-files endpoint must refuse while seo is off').toBe(503);
        expect((off.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
        expect(off.body, 'the withdrawn text must not be in the refusal').not.toContain('GPTBot');

        const whileOff = await detail();
        expect(whileOff.editable, 'the setting must be read-only while seo is off').toBe(false);
        expect(whileOff.values, 'the stored text must still be shown').toEqual(whileOn.values);

        for (const refused of [
          await h.app.inject({
            method: 'PUT',
            url: `${SETTING}/value`,
            cookies: admin,
            payload: { scope: 'subset', salesChannelCodes: ['default'], value: 'Disallow: /' },
          }),
          await h.app.inject({
            method: 'PUT',
            url: `${SETTING}/value`,
            cookies: admin,
            payload: { scope: 'all', value: 'Disallow: /' },
          }),
          await h.app.inject({
            method: 'DELETE',
            url: `${SETTING}/values?salesChannelCodes=default`,
            cookies: admin,
          }),
        ]) {
          expect(refused.statusCode).toBe(400);
          expect((refused.json() as { error: { code: string } }).error.code).toBe(
            'MODULE_SETTING_READ_ONLY',
          );
        }
        expect((await detail()).values, 'a refused write must change nothing').toEqual(
          whileOn.values,
        );
      });

      const back = await files();
      expect(back.statusCode).toBe(200);
      expect(
        (back.json() as { data: Record<string, string> }).data[member],
        'the stored text must be served again, unchanged, with no write in between',
      ).toBe(TEXT);
      expect((await detail()).editable).toBe(true);
    } finally {
      await h.app.inject({
        method: 'DELETE',
        url: `${SETTING}/values?salesChannelCodes=default`,
        cookies: admin,
      });
    }
  });
});
