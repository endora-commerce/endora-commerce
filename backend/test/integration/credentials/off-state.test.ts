import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `credentials` off-state — Constitution XVII item 6.
 *
 * The module's prior off-state coverage is
 * `_admin_surfaces/batch-ten-palette-off-state.test.ts`, which asserts the
 * palette action goes when the module does. That is feature 091's question;
 * item 6's are here, and the palette assertion is not repeated.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the credential list, the credential-type catalogue
 *    the admin form is built from, and a write. The type catalogue is named
 *    separately because it is the one route that answers from a registry
 *    rather than from stored rows, and a registry read that keeps answering
 *    while its module is off is how an admin screen renders as "working";
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive, which for this module is the sharpest case in the tree:
 *    every stored configuration and its encrypted secrets stay in the database
 *    and resolve again exactly as before, as the module's own activation
 *    description promises;
 *  * **storefront absence** has no subject, and that is a property of the
 *    module rather than an omission: `credentials` is the operator's secret
 *    store. It registers three routes, all under `/api/v1/admin/`, and no
 *    buyer-facing surface exists for a switched-off module to keep serving;
 *  * **non-editable configuration** has no subject either, for the reason item
 *    6 itself names. The manifest declares exactly one setting,
 *    `credentials.enabled`, and that is the module's activation control — the
 *    single exception — so the harness is given no `settingWrite` rather than
 *    one that would drive the switch that has to keep working.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and for this module it is the one that matters: an operator
 * declining the credential store from `/platform/modules` never touches the
 * lifecycle registry, and every consumer resolving a `credential_ref` setting
 * must fail closed at the port rather than read a stale value.
 */
describe('credentials off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'credentials', {
      routes: [
        { url: '/api/v1/admin/credentials', cookies: admin },
        { url: '/api/v1/admin/credentials/types', cookies: admin },
        { method: 'POST', url: '/api/v1/admin/credentials', cookies: admin, payload: {} },
      ],
      adminPresence: { cookies: admin },
    });
  });
});
