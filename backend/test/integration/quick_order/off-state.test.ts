import { afterAll, beforeAll, describe, it } from 'vitest';
import { QUICK_ORDER_SETTING_CODES } from '@endora-commerce/mod-quick-order';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `quick_order` off-state — Constitution XVII item 6.
 *
 * The module's only prior off-state coverage is
 * `backend/test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`,
 * which asserts the palette action goes when the module does. That is feature
 * 091's question; item 6's four are here, and the palette assertion is not
 * repeated.
 *
 * `quick_order` is worth a word on the axes because its surface straddles them:
 * the buyer's own quick-order form and the admin's order-on-behalf screen are
 * separate route groups, registered through the same `ctx.routes` seam, and an
 * operator switching the module off means both. The probes below name one of
 * each so that a gate applied to only one group would fail here.
 *
 *  * **API rejection** — the admin preferences read and the admin build;
 *  * **storefront absence** — the buyer's preferences read and the buyer's
 *    catalogue search behind the quick-order form. A buyer who can still paste
 *    a SKU list into a switched-off module is the failure this refuses;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **non-editable configuration** — the import row cap, an ordinary setting.
 *    The module's activation control lives in its own manifest entry and is
 *    deliberately not the code written here;
 *  * **restoration** — asserted by the harness after both axes.
 */
describe('quick_order off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const customer = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'quick_order', {
      routes: [
        { url: '/api/v1/admin/quick-order/preferences', cookies: admin },
        {
          method: 'POST',
          url: '/api/v1/admin/quick-order/build',
          cookies: admin,
          payload: {},
        },
        { url: '/api/v1/quick-order/preferences', cookies: customer },
        { url: '/api/v1/quick-order/search?q=widget', cookies: customer },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS,
        value: 500,
        cookies: admin,
      },
    });
  });
});
