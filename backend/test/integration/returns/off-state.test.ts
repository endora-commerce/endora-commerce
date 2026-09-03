import { afterAll, beforeAll, describe, it } from 'vitest';
import { RETURNS_SETTING_CODES } from '@endora-commerce/mod-returns';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `returns` off-state — Constitution XVII item 6.
 *
 * The module's prior off-state coverage is
 * `_admin_surfaces/batch-eight-palette-off-state.test.ts`, which asserts the
 * two palette actions go when the module does. That is feature 091's question;
 * item 6's are here, and the palette assertion is not repeated.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the admin RMA list and the return-status catalogue.
 *    The second is named separately because it answers from a workflow
 *    definition rather than from stored RMAs, and a workflow that keeps
 *    answering while its module is off is the module still being observable;
 *  * **storefront absence** — two buyer-facing routes, and they are different
 *    questions. `GET /api/v1/returns/reasons` is what the shop's return form
 *    is built from, and it answers to an anonymous caller: a switched-off
 *    returns module that still serves it invites a buyer into a flow that
 *    cannot complete. `GET /api/v1/returns` is the signed-in buyer's own RMA
 *    list;
 *  * **non-editable configuration** — the free-return window in days, an
 *    ordinary setting. `returns.enabled` is deliberately *not* the code
 *    written here: it is the module's activation control, the single exception
 *    item 6 names;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: RMAs, their comments, their settlements and the reason
 *    catalogue all stay, and the restored probes hold the routes to it.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator creates: a shop that handles
 * returns by telephone switches this off from `/platform/modules` while the
 * deployment still offers it.
 */
describe('returns off-state (Constitution XVII)', () => {
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
    await expectModuleAbsent(h, 'returns', {
      routes: [
        { url: '/api/v1/admin/returns', cookies: admin },
        { url: '/api/v1/admin/returns/statuses', cookies: admin },
        { url: '/api/v1/returns/reasons', headers: channel },
        { url: '/api/v1/returns', headers: channel },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: RETURNS_SETTING_CODES.FREE_RETURN_DAYS,
        value: 7,
        cookies: admin,
      },
    });
  });
});
