import { afterAll, beforeAll, describe, it } from 'vitest';
import { CMS_PAGE_BUILDER_SETTING_CODES } from '@endora-commerce/mod-cms';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

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
 *    shop's content page is rendered from. A switched-off CMS that still
 *    serves it is the operator's withdrawal being invisible on the only
 *    surface a buyer looks at, and it is a different question from the editor
 *    going 503;
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
    await expectModuleAbsent(h, 'cms', {
      routes: [
        { url: '/api/v1/admin/cms/pages', cookies: admin },
        { method: 'POST', url: '/api/v1/admin/cms/pages', cookies: admin, payload: {} },
        { url: '/api/v1/cms/pages/by-slug?slug=home', headers: channel },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: CMS_PAGE_BUILDER_SETTING_CODES.BREAKPOINT_TABLET_MIN,
        value: 700,
        cookies: admin,
      },
    });
  });
});
