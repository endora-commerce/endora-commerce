import { afterAll, beforeAll, describe, it } from 'vitest';
import { PROMPT_ACTIONS_SETTING_CODES } from '@endora-commerce/mod-prompt-actions';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `prompt_actions` off-state — Constitution XVII item 6.
 *
 * This module is the one where the two switches are easiest to confuse, and its
 * own manifest says so in place: `prompt_actions.enabled` is the assistant's
 * kill switch and leaves the module **present** (the capability endpoint
 * answers `200 {status:'disabled'}`, a submission answers `409
 * ASSISTANT_DISABLED`), while `prompt_actions.activation` is the Constitution
 * XVII axis and makes the module **absent**. Only the second is what this file
 * drives, through the harness, which reads the activation declaration from the
 * manifest rather than taking it as an argument.
 *
 * Item 6's four surfaces:
 *
 *  * **API rejection** — the capability probe and the request queue, the two
 *    routes the admin assistant panel is built on. `capability` is the
 *    important one: it is what the palette reads to decide whether to offer
 *    prompt mode, and an answer of any kind from a switched-off module is the
 *    module still being observable;
 *  * **admin absence** — the presence projection, plus the `/admin-roles`
 *    permission catalogue the harness sweeps unasked;
 *  * **non-editable configuration** — the bulk limit, an ordinary setting.
 *    Neither `ACTIVATION` (the control item 6 exempts) nor `ENABLED` (the
 *    module's own kill switch, which is a different question) is written here;
 *  * **restoration** — asserted by the harness after both axes.
 *
 * There is **no storefront surface** and that is a property of the module, not
 * a gap in this test: `prompt_actions` registers admin routes only, so there is
 * no storefront element for an operator to still see. The manifest declares no
 * palette action either, so there is nothing for the action registry to
 * withdraw.
 */
describe('prompt_actions off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'prompt_actions', {
      routes: [
        { url: '/api/v1/admin/prompt-actions/capability', cookies: admin },
        { url: '/api/v1/admin/prompt-actions/requests', cookies: admin },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: PROMPT_ACTIONS_SETTING_CODES.BULK_LIMIT,
        value: 25,
        cookies: admin,
      },
    });
  });
});
