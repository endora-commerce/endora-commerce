import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `product_feeds`' **server-side** off-state, for the surface feature 091's
 * Phase 4 moved into its package — the batch `plan.md`'s sequence table calls
 * batch 7.
 *
 * One file per module, deliberately, as batch five's carrier pair and batch
 * six's set are: two modules whose batch membership is one fact about their
 * reaches are still two platforms, and an off-state proof with a shared body
 * would be one declaration standing for both.
 *
 * Two questions. The module's admin API and both presence projections are
 * driven through `expectModuleAbsent`, which also holds the permission
 * catalogue to the same answer — this module had no off-state file at all
 * before the drain, so both halves arrive here. The **palette** is the second:
 * Constitution XVII item 5 lists a palette action among the surfaces a
 * switched-off module must not contribute, and the Actions group is resolved
 * *here* — by the server, from the manifests, against the effective enabled-set
 * — so no admin-side test can see it.
 *
 * **Both route groups are listed, and that is the point of listing any.** The
 * feeds themselves and the templates are two registration groups behind one
 * seam (`routes.admin.ts` and `routes.templates.ts`, with `routes.taxonomies.ts`
 * and `routes.delivery.ts` beside them), and a gate that held for only one of
 * them would still be a defect — a template editor that kept answering while
 * the module was off is a surface an operator was told is not running.
 *
 * The route and sidebar halves of item 5 are proved in the admin, where the
 * gate is `App.tsx`'s `ModuleRoute` and `composeNav`'s filter —
 * `admin/test/modules/product-feeds.module-owned-surface.test.tsx`.
 *
 * Driven on the **operator** axis, which is the one an operator actually
 * creates and the one a platform-availability flip would hide. This module
 * declares an activation control with a default of `true`, so it has one.
 *
 * No `settingWrite`: the module's activation control is itself a Setting it
 * owns, which is the single documented exception to the
 * non-editable-configuration rule.
 */
describe('product_feeds contributes no admin surface while off (Constitution XVII item 5)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** The palette entries this module advertises, in id order. */
  const actionIds = async (): Promise<string[]> => {
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
      .filter((action) => action.moduleId === 'product_feeds')
      .map((action) => action.actionId)
      .sort();
  };

  it('refuses its admin API and disappears from both presence projections while off', async () => {
    await expectModuleAbsent(h, 'product_feeds', {
      routes: [
        { url: '/api/v1/admin/product-feeds', cookies: admin },
        { url: '/api/v1/admin/feed-templates', cookies: admin },
      ],
      adminPresence: { cookies: admin },
    });
  });

  it('advertises no palette action while off, and its own six again after', async () => {
    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry answering nothing to anybody would pass.
    const OWN = [
      'create-product-feed',
      'import-feed-template',
      'open-feed-category-mapping',
      'open-feed-taxonomy-revisions',
      'open-feed-templates',
      'open-product-feeds',
    ];
    expect(await actionIds()).toEqual(OWN);
    await withModuleOff('product_feeds', 'deactivated', async () => {
      expect(await actionIds()).toEqual([]);
    });
    expect(await actionIds()).toEqual(OWN);
  });
});
