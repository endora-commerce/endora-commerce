import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { META_ADS_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `meta_ads` off-state — Constitution XVII item 6, for the module feature 091's
 * Phase 4 batch three moved into its own package.
 *
 * The twin of `backend/test/integration/linkedin_ads/off-state.test.ts`, and
 * kept as its own file rather than folded into one parameterised suite. The two
 * modules are a pair for the *batch*, which is a fact about their reaches; they
 * are not one module, and an off-state proof that shared a body would be one
 * declaration standing for two platforms — the shape that makes a second
 * module's regression invisible because the first module's surfaces are the
 * ones the table happens to name.
 *
 * The storefront config read is the assertion that carries the operator's
 * meaning: switching Meta Ads off and still having the Pixel load is the
 * failure this asserts cannot happen, and it is a different question from the
 * admin CRUD going 503.
 *
 * `meta_ads.module_enabled` is deliberately not the setting written below. It
 * is the module's activation control — the single exception item 6 names — and
 * a test that wrote it while off would be driving the one switch that has to
 * keep working.
 */
describe('meta_ads off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'meta_ads', {
      routes: [
        { url: '/api/v1/admin/meta-ads/custom-events', cookies: admin },
        { url: '/api/v1/admin/meta-ads/action-catalogue', cookies: admin },
        {
          url: '/api/v1/storefront/meta-ads/config',
          headers: { 'x-sales-channel': 'default' },
        },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: META_ADS_SETTING_CODES.PIXEL_ID,
        value: '1234567890',
        cookies: admin,
      },
    });
  });

  it('advertises neither palette action while off, and both again after', async () => {
    // Principle XVII item 5's "no palette action". Since batch three the ⌘K
    // entry is the only server-side advertisement of this module's screens that
    // is left — `App.tsx` and `AppShell.tsx` no longer name the module at all —
    // so a stale answer here would be an operator being offered a screen the
    // registry has already withdrawn.
    //
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
        .filter((action) => action.moduleId === 'meta_ads')
        .map((action) => action.actionId)
        .sort();
    };

    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry that answered nothing to anybody would pass.
    expect(await ids()).toEqual(['new-meta-custom-event', 'open-meta-ads']);
    await withModuleOff('meta_ads', 'deactivated', async () => {
      expect(await ids()).toEqual([]);
    });
    expect(await ids()).toEqual(['new-meta-custom-event', 'open-meta-ads']);
  });
});
