import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOOGLE_ANALYTICS_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `google_analytics` off-state — Constitution XVII item 6, from a **package**
 * (feature 080, T040b).
 *
 * The module lives in `packages/modules/google_analytics` now and every gate it
 * relies on is applied by `ctx.routes` in the kernel container. Nothing about
 * that seam is supposed to change when a module's sources move; this file is
 * what turns "supposed to" into a measurement, over both axes and over the
 * restoration.
 *
 * Two surfaces are declared rather than one, because this module owns both
 * halves of an integration: the admin custom-events CRUD, and the storefront
 * config the browser reads before it loads GA4 at all. An operator switching
 * Google Analytics off and still seeing a tag load is the failure this asserts
 * cannot happen.
 *
 * The queue consumer is the third surface and is **not** here: it has no HTTP
 * seam and the harness composes no queue (`moduleQueueRedis: undefined`). Its
 * proof is `packaged-worker.test.ts`, beside this file, which also records what
 * the platform's stop switch does and does not reach.
 *
 * **The palette is the fourth, and it arrived with feature 091's Phase 4.** The
 * module's admin screens now live in
 * `packages/modules/google_analytics/src/admin/`, and the route and the sidebar
 * entry are withdrawn at render by the admin's own `isSurfaceVisible` — proved
 * in `admin/test/modules/google-analytics.module-owned-surface.test.tsx`. The
 * ⌘K palette's Actions group is not: it is resolved **here**, by the server,
 * from the manifest's `actions` against the effective enabled-set, and no
 * admin-side test can see that. So the third surface Constitution XVII item 5
 * names is asserted at the only place that can answer it.
 */
describe('google_analytics off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'google_analytics', {
      routes: [
        { url: '/api/v1/admin/google-analytics/custom-events', cookies: admin },
        { url: '/api/v1/admin/google-analytics/action-catalogue', cookies: admin },
        {
          url: '/api/v1/storefront/google-analytics/config',
          headers: { 'x-sales-channel': 'default' },
        },
        {
          method: 'POST',
          url: '/api/v1/storefront/google-analytics/collect',
          headers: { 'x-sales-channel': 'default' },
          payload: {
            clientId: 'client-1',
            consent: { analyticsStorage: 'granted' },
            events: [{ name: 'view_item', params: {} }],
          },
        },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: GOOGLE_ANALYTICS_SETTING_CODES.MEASUREMENT_ID,
        value: 'G-OFFSTATE01',
        cookies: admin,
      },
    });
  });

  it('advertises neither palette action while off, and both again after', async () => {
    // Principle XVII item 5's "no palette action", for the module whose screens
    // this action list is the only remaining server-side advertisement of.
    // Driven on the operator axis, which is the one an operator actually
    // creates and the one a platform-availability flip would hide.
    const ids = async (): Promise<string[]> => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/admin-actions?language=en',
        cookies: admin,
      });
      expect(res.statusCode, 'the palette registry must answer').toBe(200);
      // The envelope wraps the paged payload, so the rows are one level deeper
      // than an ordinary list route's.
      const body = res.json() as { data: { data: { actionId: string; moduleId: string }[] } };
      return body.data.data
        .filter((action) => action.moduleId === 'google_analytics')
        .map((action) => action.actionId);
    };

    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry that answered nothing to anybody would pass.
    expect(await ids()).toEqual(
      expect.arrayContaining(['open-google-analytics', 'new-google-analytics-event']),
    );
    await withModuleOff('google_analytics', 'deactivated', async () => {
      expect(await ids()).toEqual([]);
    });
    expect(await ids()).toEqual(
      expect.arrayContaining(['open-google-analytics', 'new-google-analytics-event']),
    );
  });
});
