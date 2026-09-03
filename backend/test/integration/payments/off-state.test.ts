import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `payments` off-state — Constitution XVII item 6.
 *
 * The module is named by six `withModuleOff` callers and **none of them sits
 * under `payments/`** — they are the five gateway modules (`autopay`, `paypal`,
 * `payu`, `stripe`, `tpay`) and `payment_methods`, each asserting that *it*
 * degrades correctly when the payments module is absent. That is a consumer's
 * question. Item 6's is this module's own surfaces, which nothing asserted,
 * and the six files are exactly why a path predicate cannot find that out.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the admin payment history for an order, plus the
 *    gateway **ingress**. The ingress is the one that matters: it is where a
 *    provider's confirmation lands, and a switched-off payments module that
 *    still accepts one would record money against an order on behalf of a
 *    capability the operator withdrew. It is asserted with an empty payload
 *    deliberately — the gate is an `onRequest` hook, so it must refuse before
 *    the body schema is even read;
 *  * **storefront absence** — `POST /api/v1/orders/:orderId/payments/retry`,
 *    the buyer's own "try paying again" action on a failed order. A buyer
 *    still able to start a payment attempt while the operator has switched
 *    payments off is the withdrawal being invisible where it matters most;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: recorded payments, their attempts and their provider
 *    references all stay, and the restored probes hold the routes to it;
 *  * **non-editable configuration** has no subject, for the reason item 6
 *    itself names. The manifest declares exactly one setting,
 *    `payments.enabled`, and that is the module's activation control — the
 *    single exception — so the harness is given no `settingWrite` rather than
 *    one that would drive the switch that has to keep working. Every knob a
 *    gateway offers belongs to that gateway's own module.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and for this module it is the operator action with the
 * largest blast radius: switching payments off from `/platform/modules` leaves
 * the lifecycle registry untouched and every gateway installed.
 */
describe('payments off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const channel = { 'x-sales-channel': 'default' };
  // A syntactically valid id that owns nothing: each probe must be refused for
  // the module's sake, never for the row's.
  const orderId = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'payments', {
      routes: [
        { url: `/api/v1/admin/orders/${orderId}/payments`, cookies: admin },
        { method: 'POST', url: '/api/v1/payments/receive', cookies: admin, payload: {} },
        {
          method: 'POST',
          url: `/api/v1/orders/${orderId}/payments/retry`,
          headers: channel,
          payload: {},
        },
      ],
      adminPresence: { cookies: admin },
    });
  });
});
