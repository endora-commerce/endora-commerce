import { afterAll, beforeAll, describe, it } from 'vitest';
import { SEARCH_SETTING_CODES } from '@endora-commerce/mod-search';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `search` off-state — Constitution XVII item 6.
 *
 * The module had no off-state proof at all. The derivation that found that is
 * worth stating, because the obvious one is wrong: a grep for the harness under
 * `backend/test/*\/search/` answers about a *directory*, and a file under
 * `backend/test/integration/stripe/` may well be asserting `payments` off
 * rather than `stripe`. The population is the **argument** of the harness call,
 * and read that way `search` was one of five switchable modules no test named.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — both halves of the module's own API. The admin half
 *    (`/api/v1/admin/search/*`) is the operator's LLM configuration screen; the
 *    public half (`/api/v1/search/suggest`) is the storefront typeahead popup,
 *    which is also this module's **storefront** surface. A buyer still getting
 *    suggestions from a switched-off search module is the failure this asserts
 *    cannot happen, and it is a different question from the admin screens going
 *    503;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue, which the harness sweeps on every
 *    call without being asked (issue #213);
 *  * **non-editable configuration** — the popup suggestion count, an ordinary
 *    setting. `search.enabled` is deliberately *not* the code written here: it
 *    is the module's activation control, the single exception item 6 names, and
 *    a test that wrote it while off would be driving the one switch that has to
 *    keep working;
 *  * **restoration** — asserted by the harness after both axes.
 *
 * Both axes are driven, and the operator one first: a module that is
 * platform-available but deactivated is the case an operator actually creates,
 * and a proof that only took the platform axis away would pass on code that
 * ignores activation entirely.
 *
 * There is no palette assertion here because the manifest declares no action —
 * `search` contributes a settings group and no `actions` entry, so there is
 * nothing for the registry to withdraw.
 */
describe('search off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'search', {
      routes: [
        {
          method: 'POST',
          url: '/api/v1/admin/search/llm/toggle',
          cookies: admin,
          payload: { enabled: false },
        },
        {
          url: '/api/v1/search/suggest?q=widget',
          headers: { 'x-sales-channel': 'default' },
        },
        {
          method: 'POST',
          url: '/api/v1/search/record',
          headers: { 'x-sales-channel': 'default' },
          payload: { phrase: 'widget', resultCount: 0 },
        },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: SEARCH_SETTING_CODES.POPUP_SUGGESTION_COUNT,
        value: 6,
        cookies: admin,
      },
    });
  });
});
