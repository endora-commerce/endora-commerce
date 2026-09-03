import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOOGLE_TAG_MANAGER_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * `google_tag_manager` off-state — Constitution XVII item 6.
 *
 * The module had no off-state proof of any kind, and for this one the absence
 * mattered more than for most: GTM's whole surface is a **storefront** one, and
 * a switched-off analytics module that still hands a container ID to the shop
 * is the module going on collecting after the operator withdrew that
 * disclosure. That is the same failure shape the worker gate was repaired for
 * (`defineModuleWorker` gating on the registry cache, AGENTS.md § *Module
 * enable/disable* item 2) and it is asserted here rather than assumed.
 *
 * Item 6's four surfaces, on a module whose admin half is a settings screen and
 * nothing more:
 *
 *  * **API rejection / storefront absence** — the same two routes answer both,
 *    because both routes are the storefront's. `config` is what the shop reads
 *    to decide whether to load the container at all, and `collect` is the
 *    server-side relay's ingest;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the palette action below and the `/admin-roles` permission catalogue,
 *    which the harness sweeps on every call;
 *  * **non-editable configuration** — the container ID, an ordinary setting.
 *    `google_tag_manager.module_enabled` is the activation control and is
 *    deliberately not the code written here;
 *  * **restoration** — asserted by the harness after both axes.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one that matters for a module like this: an
 * operator switching GTM off never touches the lifecycle registry.
 */
describe('google_tag_manager off-state (Constitution XVII)', () => {
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
    await expectModuleAbsent(h, 'google_tag_manager', {
      routes: [
        { url: '/api/v1/storefront/google-tag-manager/config', headers: channel },
        {
          method: 'POST',
          url: '/api/v1/storefront/google-tag-manager/collect',
          headers: channel,
          payload: { events: [] },
        },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: GOOGLE_TAG_MANAGER_SETTING_CODES.CONTAINER_ID,
        value: 'GTM-OFFSTATE',
        cookies: admin,
      },
    });
  });

  it('advertises no palette action while deactivated, and it again after', async () => {
    // Principle XVI item 5's "no palette action". The registry is resolved
    // here, by the server, from the manifest against the effective enabled-set
    // — no admin-side test can see it, so it is asserted at the only place that
    // can answer it.
    //
    // The operator axis is the one driven, because it is the one an operator
    // creates and the one a platform-availability flip would hide.
    const ids = async (): Promise<string[]> => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/admin-actions?language=en',
        cookies: admin,
      });
      expect(res.statusCode, 'the palette registry must answer').toBe(200);
      const body = res.json() as { data: { data: { actionId: string; moduleId: string }[] } };
      return body.data.data
        .filter((action) => action.moduleId === 'google_tag_manager')
        .map((action) => action.actionId)
        .sort();
    };

    // The positive control comes first: without it an empty list would prove
    // nothing, because a registry answering nothing to anybody would pass.
    expect(await ids()).toEqual(['open-google-tag-manager']);
    await withModuleOff('google_tag_manager', 'deactivated', async () => {
      expect(await ids()).toEqual([]);
    });
    expect(await ids()).toEqual(['open-google-tag-manager']);
  });
});
