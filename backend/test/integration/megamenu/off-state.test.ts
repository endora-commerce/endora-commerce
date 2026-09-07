import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `megamenu` off-state — Constitution XVII item 6.
 *
 * The module's prior off-state coverage is
 * `backend/test/integration/_admin_surfaces/batch-eight-palette-off-state.test.ts`,
 * which asserts the palette action goes when the module does. That is feature
 * 091's question; item 6's are here, and the palette assertion is not repeated.
 *
 * The probe that carries this file is the **storefront** one.
 * `GET /api/v1/megamenu/by-channel` is what the shop's navigation is built
 * from, and a switched-off megamenu that still answers it is the operator's
 * withdrawal being invisible on the only surface a buyer looks at. It is a
 * different question from the admin editor going 503, so both are named.
 *
 *  * **API rejection** — the admin menu list and an admin write;
 *  * **storefront absence** — the channel-resolved navigation read;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: the menus, their items and their channel bindings all
 *    stay, and the restored probes hold the routes to it;
 *  * **non-editable configuration** has no subject. The manifest declares one
 *    setting, `megamenu.enabled`, and that is the module's activation control
 *    — the exception item 6 names — so the harness is given no `settingWrite`
 *    rather than one that would drive the switch that has to keep working.
 *
 * The **deactivated-while-platform-available** case is the first axis driven,
 * and it is the one an operator creates: switching the megamenu off from
 * `/platform/modules` never touches the lifecycle registry.
 */
describe('megamenu off-state (Constitution XVII)', () => {
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
    await expectModuleAbsent(h, 'megamenu', {
      routes: [
        { url: '/api/v1/admin/megamenu/menus', cookies: admin },
        {
          method: 'POST',
          url: '/api/v1/admin/megamenu/menus',
          cookies: admin,
          payload: {},
        },
        { url: '/api/v1/megamenu/by-channel', headers: channel },
      ],
      adminPresence: { cookies: admin },
    });
  });
});
