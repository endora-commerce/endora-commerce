import { afterAll, beforeAll, describe, it } from 'vitest';
import { INVOICES_SETTING_CODES } from '@endora-commerce/mod-invoices';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `invoices` off-state — Constitution XVII item 6.
 *
 * The module is named by four `withModuleOff` callers and none of them asserts
 * item 6's question. Two are *consumers* failing closed without it (`orders`
 * order-taking, `returns` settlement ordering), one is feature 091's palette
 * assertion, and one — `invoices/numbering-off-state.test.ts` — is about a
 * numbering **sequence** while the module is off, which is a property of the
 * counter rather than of the module's surfaces. The palette assertion is not
 * repeated here.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the invoice list and the invoice-template list. The
 *    second is named separately because templates are edited through the page
 *    builder, a surface with its own configuration endpoint, and an editor
 *    that keeps loading while its module is off is the module still being
 *    observable;
 *  * **storefront absence** — `GET /api/v1/orders/:id/invoices`, the buyer's
 *    own document list on the order screen. A switched-off invoices module
 *    that still lists a buyer's documents is the operator's withdrawal being
 *    invisible on the surface a buyer looks at, and it is a different question
 *    from the admin screens going 503;
 *  * **non-editable configuration** — the seller tax id, an ordinary setting.
 *    `invoices.enabled` is deliberately *not* the code written here: it is the
 *    module's activation control, the single exception item 6 names;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: issued invoices, their numbers, their PDFs and their
 *    templates all stay, and the restored probes hold the routes to it.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator creates: a shop that invoices
 * outside the platform declines this from `/platform/modules` while the
 * deployment still offers it.
 */
describe('invoices off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const channel = { 'x-sales-channel': 'default' };
  // A syntactically valid id that owns nothing: the buyer-facing probe must be
  // refused for the module's sake, never for the row's.
  const orderId = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'invoices', {
      routes: [
        { url: '/api/v1/admin/invoices', cookies: admin },
        { url: '/api/v1/admin/invoice-templates', cookies: admin },
        { url: `/api/v1/orders/${orderId}/invoices`, headers: channel },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: INVOICES_SETTING_CODES.SELLER_TAX_ID,
        value: '1234567890',
        cookies: admin,
      },
    });
  });
});
