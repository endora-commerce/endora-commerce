import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `admin_notifications` off-state — Constitution XVII item 6.
 *
 * Item 6 asks for four things, and this module can honestly answer three of
 * them. Saying which one it cannot, and why, is the point of this block: a
 * missing assertion that is a property of the module reads exactly like one
 * somebody forgot.
 *
 *  * **API rejection** — the bell's feed and its mark-all-read write, the two
 *    routes the module owns. Both must carry the `MODULE_DISABLED` envelope
 *    while off;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue, which the harness sweeps on every
 *    call. This module owns `admin:read`, so the catalogue half is not vacuous
 *    here;
 *  * **restoration** — asserted by the harness after both axes, and the whole
 *    of it: switching a module off drops no row, so the notifications written
 *    while it was off are there when it comes back;
 *  * **storefront absence** is vacuous by construction — the module registers
 *    admin routes only and contributes no storefront element, so there is
 *    nothing a buyer could still see;
 *  * **non-editable configuration** has no subject. The manifest declares
 *    exactly one setting, `admin_notifications.enabled`, and that is the
 *    module's own activation control — the single exception item 6 names.
 *    Writing it while off would be driving the one switch that has to keep
 *    working, so the harness is given no `settingWrite` rather than a
 *    misleading one.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives; the platform axis follows it, and the two are asserted
 * independently.
 */
describe('admin_notifications off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'admin_notifications', {
      routes: [
        { url: '/api/v1/admin/notifications', cookies: admin },
        { method: 'POST', url: '/api/v1/admin/notifications/mark-all-read', cookies: admin },
      ],
      adminPresence: { cookies: admin },
    });
  });
});
