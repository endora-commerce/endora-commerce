import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `shipments` off-state — Constitution XVII item 6.
 *
 * The module's only prior mention of the off-state harness is
 * `delivery_methods/shipment-usage-guard.test.ts`, and that is a *consumer's*
 * question: whether the delivery-method delete guard fails closed when it
 * cannot ask shipments about usage. Item 6's question — this module's own
 * surfaces while it is off — was asserted nowhere, and the file that names it
 * sits under another module's directory, which is why a path predicate cannot
 * find that out.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — all three routes the module owns, which is the whole
 *    of its API: the per-order shipment history, the shipment **creation**
 *    write, and the receive ingress. The write is the one that matters most —
 *    creating a shipment contacts a carrier and moves an order forward, so a
 *    switched-off shipments module that still accepts one is acting on behalf
 *    of a capability the operator withdrew. Both writes are probed with an
 *    empty payload deliberately: the gate is an `onRequest` hook, so it must
 *    refuse before the body schema is read;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: shipments, their attempts, their carrier references and
 *    their statuses all stay, and the restored probes hold the routes to it;
 *  * **storefront absence** has no subject, and that is a property of the
 *    module rather than an omission. `shipments` registers three routes and
 *    every one of them is admin-guarded — the receive ingress included, which
 *    its own routes file records as a deliberate MVP decision pending a signed
 *    carrier-webhook path. There is no buyer-facing surface for a switched-off
 *    module to keep serving; what a buyer sees of a shipment is served by
 *    `orders`;
 *  * **non-editable configuration** has no subject either, for the reason item
 *    6 itself names. The manifest declares exactly one setting,
 *    `shipments.enabled`, and that is the module's activation control — the
 *    single exception — so the harness is given no `settingWrite` rather than
 *    one that would drive the switch that has to keep working.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator creates: a shop whose carrier
 * integration is not live yet switches this off from `/platform/modules`
 * while the deployment still offers it.
 */
describe('shipments off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
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
    await expectModuleAbsent(h, 'shipments', {
      routes: [
        { url: `/api/v1/admin/orders/${orderId}/shipments`, cookies: admin },
        {
          method: 'POST',
          url: `/api/v1/admin/orders/${orderId}/shipments`,
          cookies: admin,
          payload: {},
        },
        { method: 'POST', url: '/api/v1/shipments/receive', cookies: admin, payload: {} },
      ],
      adminPresence: { cookies: admin },
    });
  });
});
