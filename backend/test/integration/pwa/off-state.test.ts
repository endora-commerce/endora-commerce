import { afterAll, beforeAll, describe, it } from 'vitest';
import { PWA_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `pwa` off-state — Constitution XVII item 6.
 *
 * The module is named by two `withModuleOff` callers and neither is item 6's
 * question: `_admin_surfaces/batch-ten-palette-off-state.test.ts` is feature
 * 091's palette assertion, and `pwa/module-owned-surface-off-state.test.ts` is
 * feature 091's *admin contribution* question — whether a module-owned admin
 * surface withdraws. Neither probes the module's API, its storefront or its
 * configuration, and the palette assertion is not repeated here.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the admin PWA configuration read and a write to it.
 *    Both halves are named because this module's admin surface *is* a
 *    configuration editor, so a read that keeps answering renders a screen an
 *    operator can believe is live;
 *  * **storefront absence** — two buyer-facing routes, and they are different
 *    questions. `GET /api/v1/storefront/pwa/config` is what the shop reads to
 *    decide whether it is installable at all;
 *    `POST /api/v1/storefront/pwa/subscriptions` is where a browser registers
 *    for push. The second is the sharper one: a subscription accepted while
 *    the module is off is a device enrolled into notifications the operator
 *    withdrew — the same class of defect the worker gate was repaired for,
 *    one surface over;
 *  * **non-editable configuration** — the theme colour, an ordinary setting.
 *    `pwa.enabled` is deliberately *not* the code written here: it is the
 *    module's activation control, the single exception item 6 names;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: the manifest configuration, the icon asset, the VAPID
 *    keys and every stored subscription stay, and the restored probes hold the
 *    routes to it.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator creates: withdrawing the
 * installable-app capability from `/platform/modules` never touches the
 * lifecycle registry.
 */
describe('pwa off-state (Constitution XVII)', () => {
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
    await expectModuleAbsent(h, 'pwa', {
      routes: [
        { url: '/api/v1/admin/pwa/config', cookies: admin },
        { method: 'PUT', url: '/api/v1/admin/pwa/config', cookies: admin, payload: {} },
        { url: '/api/v1/storefront/pwa/config', headers: channel },
        {
          method: 'POST',
          url: '/api/v1/storefront/pwa/subscriptions',
          headers: channel,
          payload: {},
        },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: PWA_SETTING_CODES.THEME_COLOR,
        value: '#123456',
        cookies: admin,
      },
    });
  });
});
