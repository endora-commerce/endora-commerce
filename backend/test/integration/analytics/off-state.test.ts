import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `analytics` off-state — Constitution XVII item 6, for the module feature
 * 091's Phase 4 batch two moved into its own package.
 *
 * There was no off-state test for this module before. That is not an oversight
 * this batch happened to notice: the batch is what makes the module's admin
 * surface the module's, and item 6 asks for the proof over the surfaces that
 * surface now consists of. Three of them are answered here and one elsewhere:
 *
 *  * the **routes**, admin and public alike — the dashboard's summary read and
 *    the storefront's own event ingest, which is the surface an operator who
 *    switches analytics off is actually asking to stop;
 *  * the **admin presence projection**, which is what both frontends resolve
 *    their gating from;
 *  * the **palette action**, which is resolved *here*, by the server, from the
 *    manifest's `actions` against the effective enabled-set. No admin-side test
 *    can see that, so it is asserted at the only place that can answer it —
 *    the split `google_analytics`' file records beside it;
 *  * the **route and the sidebar entry** are withdrawn at render by the admin's
 *    own `isSurfaceVisible`, and are proved in
 *    `admin/test/modules/analytics.module-owned-surface.test.tsx`.
 *
 * `settingWrite` is deliberately absent: the module owns exactly one setting,
 * `analytics.enabled`, and that is its activation control — the single
 * exception item 6 names, covered by the activation endpoint's own contract
 * test rather than here. A test that wrote it while off would be driving the
 * one switch that has to keep working.
 */
describe('analytics off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'analytics', {
      routes: [
        { url: '/api/v1/admin/analytics/summary', cookies: admin },
        {
          // The public ingest. It carries no auth gate by design (FR-110), so
          // it is the one surface where "the module is off" and "the caller is
          // not allowed" cannot be confused for one another: a switched-off
          // module must refuse the batch outright rather than accept and drop
          // it, which is what an operator asked for when they switched it off.
          method: 'POST',
          url: '/api/v1/analytics/events',
          payload: {
            events: [
              {
                type: 'product.viewed',
                occurredAt: new Date().toISOString(),
                properties: {},
              },
            ],
          },
        },
      ],
      adminPresence: { cookies: admin },
    });
  });

  it('advertises no palette action while off, and the entry again after', async () => {
    // Principle XVII item 5's "no palette action". The declaration is new in
    // this merge request — `analytics` had a sidebar entry and no ⌘K entry
    // since feature 018, which Principle XVI says is not enough — so this is
    // both the off-state proof and the first assertion that the action exists.
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
        .filter((action) => action.moduleId === 'analytics')
        .map((action) => action.actionId);
    };

    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry that answered nothing to anybody would pass.
    expect(await ids()).toEqual(['open-analytics']);
    await withModuleOff('analytics', 'deactivated', async () => {
      expect(await ids()).toEqual([]);
    });
    expect(await ids()).toEqual(['open-analytics']);
  });
});
