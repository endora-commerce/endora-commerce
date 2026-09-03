import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

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
 *  * **storefront absence** — `GET /api/v1/catalog/sitemap.xml`, asserted in
 *    the second test below rather than through the harness, for a reason given
 *    there;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: generated sitemaps and every per-entity meta override
 *    stay, and the restored probes hold the routes to it;
 *  * **non-editable configuration** has no subject, for the reason item 6
 *    itself names. The manifest declares exactly one setting, `seo.enabled`,
 *    and that is the module's activation control — the single exception — so
 *    the harness is given no `settingWrite` rather than one that would drive
 *    the switch that has to keep working.
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

  it('is absent from every admin surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'seo', {
      routes: [
        { url: '/api/v1/admin/seo/sitemap', cookies: admin },
        {
          method: 'POST',
          url: '/api/v1/admin/seo/sitemap/default/regenerate',
          cookies: admin,
          payload: {},
        },
      ],
      adminPresence: { cookies: admin },
    });
  });

  /**
   * The storefront surface, asserted here rather than in the harness's `routes`
   * list — and the reason is a property of the route, not a preference.
   *
   * `GET /api/v1/catalog/sitemap.xml` answers `application/xml` on **every**
   * path it takes, including its own no-channel path, which is a 503 carrying
   * an empty `<urlset/>`. The harness reads `res.json()` on each probe in every
   * phase, so an XML body would throw a parse error before any assertion ran,
   * and a 503 that means "no channel resolved" is indistinguishable by status
   * code from the 503 that means "the module is off". So this asserts on the
   * **body**: XML while the module is on, the JSON `MODULE_DISABLED` envelope
   * the platform's error handler produces while it is off.
   *
   * Both axes are driven, and the operator one first — the same order and the
   * same reason as the harness's.
   */
  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'stops serving the storefront sitemap while off (%s), and serves it again after',
    async (axis) => {
      const sitemap = async () =>
        h.app.inject({ method: 'GET', url: '/api/v1/catalog/sitemap.xml', headers: channel });

      // Positive control: without it an always-broken route would read as a
      // successful absence.
      const before = await sitemap();
      expect(String(before.headers['content-type'])).toContain('xml');
      expect(before.body.startsWith('<?xml')).toBe(true);

      await withModuleOff('seo', axis, async () => {
        const off = await sitemap();
        expect(off.statusCode, 'the sitemap must refuse while seo is off').toBe(503);
        expect(
          (JSON.parse(off.body) as { error?: { code?: string } }).error?.code,
          'the sitemap must carry the MODULE_DISABLED envelope, not an empty urlset',
        ).toBe('MODULE_DISABLED');
        expect(off.headers['retry-after']).toBe('60');
      });

      const after = await sitemap();
      expect(String(after.headers['content-type'])).toContain('xml');
      expect(after.body.startsWith('<?xml')).toBe(true);
    },
  );
});
