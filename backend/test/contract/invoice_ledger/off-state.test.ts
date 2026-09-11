import { afterAll, beforeAll, describe, it } from 'vitest';
import { INVOICE_LEDGER_SETTING_CODES } from '@endora-commerce/contracts';
import { expectModuleAbsent } from '../../helpers/off-state.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `invoice_ledger` off-state — Constitution XVII item 6.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — routing read and the delivery list. Those are the
 *    operator rails a switched-off ledger must not keep answering.
 *  * **admin absence** — the presence projection both frontends gate on.
 *  * **non-editable configuration** — numbering mode. `invoice_ledger.enabled`
 *    is the activation control and is the exception item 6 names.
 *  * **storefront absence** has no subject. Ledger rails are operator-only.
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: maps and delivery rows stay.
 */
describe('invoice_ledger off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'invoice_ledger', {
      routes: [
        { url: '/api/v1/admin/invoice-ledger/routing', cookies: admin },
        { url: '/api/v1/admin/invoice-ledger/deliveries', cookies: admin },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: INVOICE_LEDGER_SETTING_CODES.NUMBERING_MODE,
        value: 'endora',
        cookies: admin,
      },
    });
  });
});
