import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LINKEDIN_ADS_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `linkedin_ads` off-state — Constitution XVII item 6, for the module feature
 * 091's Phase 4 batch three moved into its own package.
 *
 * There was no off-state test for this module before. That is not an oversight
 * this batch happened to notice: the batch is what makes the module's admin
 * surface the module's, and item 6 asks for the proof over the surfaces that
 * surface now consists of. They split across two files, and the split is not
 * arbitrary — it follows which side of the wire resolves each one:
 *
 *  * the **routes**, admin and storefront alike. The storefront config read is
 *    the one that matters most to an operator: switching LinkedIn Ads off and
 *    still having the Insight Tag load is the failure this asserts cannot
 *    happen, and it is a different question from the admin CRUD going 503;
 *  * the **admin presence projection**, which is what both frontends resolve
 *    their gating from;
 *  * the **configuration**, which item 6 requires to be non-editable while off
 *    — driven here through `settingWrite` against the module's Partner ID,
 *    which is an ordinary setting and not the activation control;
 *  * the **palette actions**, which are resolved *here*, by the server, from
 *    the manifest's `actions` against the effective enabled-set. No admin-side
 *    test can see that, so they are asserted at the only place that can answer
 *    them;
 *  * the **route and the sidebar entry** are withdrawn at render by the admin's
 *    own `isSurfaceVisible`, and are proved in
 *    `admin/test/modules/linkedin-ads.module-owned-surface.test.tsx`.
 *
 * `linkedin_ads.module_enabled` is deliberately not the setting written below.
 * It is the module's activation control — the single exception item 6 names —
 * and a test that wrote it while off would be driving the one switch that has
 * to keep working.
 */
describe('linkedin_ads off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'linkedin_ads', {
      routes: [
        { url: '/api/v1/admin/linkedin-ads/conversion-mappings', cookies: admin },
        { url: '/api/v1/admin/linkedin-ads/action-catalogue', cookies: admin },
        {
          url: '/api/v1/storefront/linkedin-ads/config',
          headers: { 'x-sales-channel': 'default' },
        },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: LINKEDIN_ADS_SETTING_CODES.PARTNER_ID,
        value: '9990001',
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
        .filter((action) => action.moduleId === 'linkedin_ads')
        .map((action) => action.actionId)
        .sort();
    };

    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry that answered nothing to anybody would pass.
    expect(await ids()).toEqual(['new-linkedin-conversion-mapping', 'open-linkedin-ads']);
    await withModuleOff('linkedin_ads', 'deactivated', async () => {
      expect(await ids()).toEqual([]);
    });
    expect(await ids()).toEqual(['new-linkedin-conversion-mapping', 'open-linkedin-ads']);
  });
});
