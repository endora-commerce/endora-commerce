import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `shopping_lists` off-state — Constitution XVII item 6.
 *
 * This module is almost entirely a **storefront** module: every route it owns
 * is a signed-in buyer's, so "API rejection" and "storefront absence" are the
 * same assertion made at the same place, and the probes below carry a customer
 * session because a buyer's is the only session those routes accept.
 *
 * The gate they are held to is the route **registration** seam, not a per
 * handler check — `ctx.routes` wraps the registration in an `onRequest` hook,
 * which runs before `requireCustomer` — so the refusal is a property of every
 * route the module owns, including ones added later. That is what makes three
 * probes enough for a surface of fourteen routes.
 *
 * Item 6's four surfaces:
 *
 *  * **API rejection / storefront absence** — the list feed, the default list
 *    and a write, so the read and write halves are both covered;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: the manifest's own description promises that every list,
 *    its items and its sharing state stay, and the restored probes are what
 *    holds the routes to it;
 *  * **non-editable configuration** has no subject. The manifest declares one
 *    setting, `shopping_lists.enabled`, and it is the module's activation
 *    control — the single exception item 6 names. The harness is given no
 *    `settingWrite` rather than one that would drive the switch that has to
 *    keep working.
 *
 * The manifest declares no palette action, so there is nothing for the action
 * registry to withdraw.
 */
describe('shopping_lists off-state (Constitution XVII)', () => {
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
    await expectModuleAbsent(h, 'shopping_lists', {
      routes: [
        { url: '/api/v1/shopping-lists', cookies: customer },
        { url: '/api/v1/shopping-lists/default', cookies: customer },
        {
          method: 'POST',
          url: '/api/v1/shopping-lists',
          cookies: customer,
          payload: { name: 'Off-state probe' },
        },
      ],
      adminPresence: { cookies: admin },
    });
  });
});
