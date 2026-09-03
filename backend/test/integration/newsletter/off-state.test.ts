import { afterAll, beforeAll, describe, it } from 'vitest';
import { NEWSLETTER_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `newsletter` off-state — Constitution XVII item 6.
 *
 * The module already had **half** a proof, and the half it had is not the half
 * this file adds. `backend/test/integration/_admin_surfaces/batch-eleven-palette-off-state.test.ts`
 * asserts the palette action goes when the module does — that is feature 091's
 * question, about the surfaces the admin drain moved into the package — and it
 * says nothing about the API, the configuration or restoration. Those are item
 * 6's, and they are what is here; the palette assertion is deliberately not
 * repeated, because two derivations of one claim are two answers waiting to
 * disagree.
 *
 * The four surfaces:
 *
 *  * **API rejection** — the admin campaign list, an admin write, and the
 *    subscriber-facing status read;
 *  * **storefront absence** — `POST /api/v1/newsletter/subscribe` is the shop's
 *    own sign-up, and it is the probe that matters most: a switched-off
 *    newsletter module that still accepts a subscription has taken an e-mail
 *    address the operator did not ask for;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **non-editable configuration** — the sender display name, an ordinary
 *    setting. `newsletter.enabled` is the activation control and is
 *    deliberately not the code written here;
 *  * **restoration** — asserted by the harness after both axes.
 *
 * The **deactivated-while-platform-available** case is the first axis driven.
 */
describe('newsletter off-state (Constitution XVII)', () => {
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
    await expectModuleAbsent(h, 'newsletter', {
      routes: [
        { url: '/api/v1/admin/newsletter/campaigns', cookies: admin },
        {
          method: 'POST',
          url: '/api/v1/admin/newsletter/campaigns',
          cookies: admin,
          payload: {},
        },
        { url: '/api/v1/newsletter/status', headers: channel },
        {
          method: 'POST',
          url: '/api/v1/newsletter/subscribe',
          headers: channel,
          payload: { email: 'off-state-probe@example.test' },
        },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: NEWSLETTER_SETTING_CODES.SENDER_FROM_NAME,
        value: 'Off-state probe',
        cookies: admin,
      },
    });
  });
});
