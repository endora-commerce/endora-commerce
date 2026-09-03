import { afterAll, beforeAll, describe, it } from 'vitest';
import { INVENTORY_SETTING_CODES } from '@endora-commerce/mod-inventory';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `inventory` off-state — Constitution XVII item 6.
 *
 * The module is named by five `withModuleOff` callers and none of them is
 * about `inventory`'s own surfaces: four are *consumers* asserting that they
 * fail closed without it (`orders` placement, `catalog` duplication,
 * `audit_logs` reference contributions, `import_export`), and the fifth is
 * feature 091's palette assertion. A consumer's fail-closed proof is a
 * different claim from "this module is absent from its own surfaces", and item
 * 6 asks for the second. The palette assertion is not repeated here.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the warehouse list and the stock-level list. Both are
 *    named because they are the two roots of this module's admin API and sit
 *    under different path prefixes (`/admin/warehouses` and
 *    `/admin/inventory/*`), so one gate holding says nothing about the other;
 *  * **storefront absence** — `GET /api/v1/storefront/inventory/display-mode`,
 *    which is what the shop asks before it decides whether to render a stock
 *    figure, a band or nothing at all. A switched-off inventory module that
 *    still answers it is an operator's withdrawal being invisible to a buyer;
 *  * **non-editable configuration** — the global low-stock threshold, an
 *    ordinary setting. `inventory.enabled` is deliberately *not* the code
 *    written here: it is the module's activation control, the single exception
 *    item 6 names;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: warehouses, stock levels, thresholds and availability
 *    notifications all stay, and the restored probes hold the routes to it.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator creates: a shop that does not
 * track stock switches this off from `/platform/modules` without the
 * deployment ever uninstalling it.
 */
describe('inventory off-state (Constitution XVII)', () => {
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
    await expectModuleAbsent(h, 'inventory', {
      routes: [
        { url: '/api/v1/admin/warehouses', cookies: admin },
        { url: '/api/v1/admin/inventory/levels', cookies: admin },
        { url: '/api/v1/storefront/inventory/display-mode', headers: channel },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_LOW,
        value: 3,
        cookies: admin,
      },
    });
  });
});
