import { afterAll, beforeAll, describe, it } from 'vitest';
import { CUSTOMERS_SETTING_CODES } from '@endora-commerce/mod-customers';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `customers` off-state — Constitution XVII item 6.
 *
 * This module deserves the most care in the residue and had the least, for a
 * reason worth writing down: **two** hand-derivations of the off-state
 * population missed it, in the same direction. Both keyed on the *path* a test
 * file sits at, and `customers` is named only by
 * `_admin_surfaces/batch-fourteen-palette-off-state.test.ts` — a file under
 * neither `customers/` nor any module directory at all. The population is the
 * **argument** of the harness call; read that way it is one of the twelve
 * modules whose only off-state claim was feature 091's palette one.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the admin customer list and the admin online-presence
 *    view. Both are named because the second answers from a freshness window
 *    rather than from the list query, and a projection that keeps answering
 *    while its module is off is the module still being observable;
 *  * **storefront absence** — two buyer-facing routes, and they are different
 *    questions. `POST /api/v1/customers/register` is the shop's sign-up form:
 *    a switched-off customers module that still creates accounts is writing
 *    rows an operator believes they withdrew the capability for.
 *    `GET /api/v1/me/customer` is the signed-in buyer's own account screen,
 *    which reads rather than writes;
 *  * **non-editable configuration** — the deletion retention window, an
 *    ordinary setting. `customers.enabled` is deliberately *not* the code
 *    written here: it is the module's activation control, the single exception
 *    item 6 names, and a test that wrote it while off would be driving the one
 *    switch that has to keep working;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: accounts, addresses, groups and their organization
 *    bindings all stay, and the restored probes hold the routes to it.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator creates: declining the
 * customers capability from `/platform/modules` never touches the lifecycle
 * registry.
 */
describe('customers off-state (Constitution XVII)', () => {
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
    await expectModuleAbsent(h, 'customers', {
      routes: [
        { url: '/api/v1/admin/customers', cookies: admin },
        { url: '/api/v1/admin/customers/online', cookies: admin },
        {
          method: 'POST',
          url: '/api/v1/customers/register',
          headers: channel,
          payload: {},
        },
        { url: '/api/v1/me/customer', headers: channel },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: CUSTOMERS_SETTING_CODES.DELETION_RETENTION_DAYS,
        value: 45,
        cookies: admin,
      },
    });
  });
});
