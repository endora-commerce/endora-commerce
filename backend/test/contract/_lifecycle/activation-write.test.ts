import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PIM_ERGONODE_SETTING_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';

/**
 * Feature 073 / US1 (T022) — `POST /api/v1/admin/modules/:id/activation`.
 *
 * The operator axis has exactly one door, and this is it. Three properties are
 * asserted here rather than assumed:
 *
 *  1. **It is a Command.** `SettingsAdminService.setValue` audits by hand after
 *     `em.flush()` and outside any transaction, which is the torn-write window
 *     Principle XIII exists to close. This endpoint runs through `CommandBus`,
 *     so the audit row lands inside the same transaction as the mutation and a
 *     rollback takes both.
 *  2. **It writes only its own axis** (Constitution XVII / FR-003). The write
 *     touches `settings.global_value` and nothing in `module_registrations`.
 *  3. **It refuses rather than no-ops.** A control that silently does nothing
 *     is worse than an absent one, because an operator believes they switched
 *     something off.
 *
 * Refusals covered here are the ones US1 owns: a non-deactivatable module, a
 * module that declares no control at all, an unknown id, and the two settings
 * paths that must not become a second door. The dependency-graph refusals
 * (deactivating with present dependents; activating while a dependency is
 * absent) are US2's and are asserted at the bottom of this file (T045/T046).
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
const ADMIN = { b2b_session: 'stub-admin-session' };
const ACTION = 'module.activation.set';
const MODULE = 'pim_ergonode';

describe('POST /api/v1/admin/modules/:id/activation [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  afterEach(async () => {
    const em = h.em();
    await em.nativeDelete(AuditLogEntry, { action: ACTION });
    // The dependency refusals (T045/T046) are exercised against real modules, so
    // more than one activation row can carry an operator choice by the end of a
    // case. Reset every code this file writes, not just the subject's.
    await em.nativeUpdate(
      Setting,
      {
        code: {
          $in: [PIM_ERGONODE_SETTING_CODES.ACTIVATION, 'price_lists.enabled', 'settings.enabled'],
        },
      },
      { globalValue: null },
    );
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  async function flip(moduleId: string, active: boolean, cookies = ADMIN) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${moduleId}/activation`,
      cookies,
      payload: { active },
    });
  }

  it('switches a module off and answers with its recomputed presence', async () => {
    const res = await flip(MODULE, false);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      module: {
        id: MODULE,
        present: false,
        activated: false,
        platformState: 'installed',
        deactivatable: true,
        nonDeactivatableReason: null,
      },
    });
  });

  it('takes effect in the running process without a redeploy', async () => {
    // The writing process refreshes its own cache rather than waiting on the
    // pub/sub round trip, so the very next request already sees the module gone.
    const before = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pim-ergonode/connection',
      cookies: ADMIN,
    });
    expect(before.json().error?.code).not.toBe('MODULE_DISABLED');

    expect((await flip(MODULE, false)).statusCode).toBe(200);

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pim-ergonode/connection',
      cookies: ADMIN,
    });
    expect(after.statusCode).toBe(503);
    expect(after.json().error?.code).toBe('MODULE_DISABLED');

    expect((await flip(MODULE, true)).statusCode).toBe(200);
    const restored = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pim-ergonode/connection',
      cookies: ADMIN,
    });
    expect(restored.json().error?.code).not.toBe('MODULE_DISABLED');
  });

  it('writes exactly one audit row naming the actor and both states', async () => {
    expect((await flip(MODULE, false)).statusCode).toBe(200);

    const em = h.em();
    em.clear();
    const entries = await em.find(AuditLogEntry, { action: ACTION });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.objectType).toBe('module');
    expect(entries[0]!.objectId).toBe(MODULE);
    expect(entries[0]!.actorAdminUserId).not.toBeNull();
    expect(entries[0]!.stateBefore).toMatchObject({ activated: true });
    expect(entries[0]!.stateAfter).toMatchObject({ activated: false });
  });

  it('persists the operator choice as the setting\'s global value', async () => {
    expect((await flip(MODULE, false)).statusCode).toBe(200);
    const em = h.em();
    em.clear();
    const setting = await em.findOne(Setting, {
      code: PIM_ERGONODE_SETTING_CODES.ACTIVATION,
    });
    expect(setting?.globalValue).toBe(false);
  });

  it('leaves the platform axis untouched — the axes never overwrite each other', async () => {
    expect((await flip(MODULE, false)).statusCode).toBe(200);
    // `module_registrations` is written only by the CLI lifecycle path. An
    // activation write that touched it would make a platform enable/disable
    // cycle silently reset the operator's choice (FR-003).
    expect(registryCache.isEnabled(MODULE)).toBe(true);
    expect(registryCache.platformStateOf(MODULE)).toBe('installed');
  });

  it('is idempotent — switching off twice writes the same state', async () => {
    expect((await flip(MODULE, false)).statusCode).toBe(200);
    const second = await flip(MODULE, false);
    expect(second.statusCode).toBe(200);
    expect(second.json().module.activated).toBe(false);
  });

  it('refuses a non-deactivatable module with its own declared reason', async () => {
    // No hard-coded exception list anywhere: the reason comes from the
    // module's manifest, which is the only place that may declare it.
    const res = await flip('_lifecycle', false);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_NOT_DEACTIVATABLE');
    expect(res.json().error.message.length).toBeGreaterThan(0);
  });

  it.each(['currencies', 'transactional_emails'])(
    'refuses the operator flip for the platform-core %s (issue #88)',
    async (moduleId) => {
      // The business decision is that these two are not a client's to switch
      // off. It binds both axes: the CLI refusal is pinned in
      // `test/unit/_lifecycle/orchestrator.test.ts`, this is the operator door.
      const declared = REGISTERED_MANIFESTS.find((e) => e.manifest.id === moduleId);
      const reason = (declared?.manifest.activation as { reason?: string } | undefined)?.reason;
      expect(reason, `${moduleId} declares no non-deactivatable reason`).toBeTruthy();

      const res = await flip(moduleId, false);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('MODULE_NOT_DEACTIVATABLE');
      expect(res.json().error.message).toBe(reason);

      // …and the admin renders a lock rather than a dead toggle, because the
      // projection carries `deactivatable: false` plus the module's own reason.
      // The screen holds no list of ids; this is what puts these two on the
      // same path `_lifecycle` and `auth` already take.
      const presence = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/module-presence',
        cookies: ADMIN,
      });
      expect(
        presence.json().modules.find((m: { id: string }) => m.id === moduleId),
      ).toMatchObject({ deactivatable: false, nonDeactivatableReason: reason, activated: true });
    },
  );

  it('refuses a module that declares no activation control', async () => {
    const undeclared = REGISTERED_MANIFESTS.find(
      (e) => e.manifest.activation === undefined,
    );
    expect(undeclared, 'the conversion sweep is complete — retire this case').toBeDefined();
    const res = await flip(undeclared!.manifest.id, false);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_NOT_DEACTIVATABLE');
  });

  it('refuses an unknown module id', async () => {
    const res = await flip('module_nobody_registered', false);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('MODULE_NOT_FOUND');
  });

  it('rejects a body that is not { active: boolean }', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${MODULE}/activation`,
      cookies: ADMIN,
      payload: { active: 'yes' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires the platform.modules.activate permission', async () => {
    const res = await flip(MODULE, false, { b2b_session: 'stub-restricted-admin-session' });
    expect(res.statusCode).toBe(403);
  });

  it('refuses to switch `settings` off while `organizations` still needs it (T045)', async () => {
    // The live defect. `organizations` is the tenancy root, is non-deactivatable
    // and declares `settings`; the CLI has refused the identical operation since
    // `assertDeactivatable` shipped, while this door let it through in silence.
    const res = await flip('settings', false);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_DEPENDENTS_PRESENT');
    expect(res.json().error.message).toContain('organizations');
    expect(res.json().error.details.blockedBy).toContain('organizations');
  });

  it('refuses to switch `price_lists` off because `catalog` resolves its pricing port (T045)', async () => {
    // The trap Amendment A1 names. `catalog` resolves `pricingService`, owned by
    // `price_lists`, through an edge the manifests deliberately withhold from
    // `dependencies` — declaring it closes a cycle. A refusal computed from the
    // manifest graph alone still answers 409 here, because `carts` and friends
    // declare `price_lists` — and would omit exactly the module whose absence
    // nobody would have predicted from reading the manifests.
    const res = await flip('price_lists', false);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_DEPENDENTS_PRESENT');
    expect(res.json().error.details.blockedBy).toContain('catalog');
  });

  it('switches a module off once nothing effectively present depends on it (T045)', async () => {
    // The refusal follows *effective presence*, not the graph: with every
    // dependent absent from this deployment the flip is ordinary again. This is
    // also the remedy the message describes — switch the dependents off first.
    const dependents = ['carts', 'catalog', 'customer_accounts', 'pim_ergonode', 'product_feeds', 'search'];
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => !dependents.includes(id)));

    const res = await flip('price_lists', false);
    expect(res.statusCode).toBe(200);
    expect(res.json().module.activated).toBe(false);
  });

  it('refuses to switch a module on while a module it needs is switched off (T046)', async () => {
    // The symmetric direction. `pim_ergonode` declares `price_lists`; switching
    // it on while the pricing engine is off buys an operator a module that
    // answers 503 from its first port call.
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['price_lists'] });

    const res = await flip(MODULE, true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_DEPENDENCIES_ABSENT');
    expect(res.json().error.message).toContain('price_lists');
    expect(res.json().error.details.missing).toContain('price_lists');
  });

  it('refuses to switch a module on while a module it needs is not installed here (T046)', async () => {
    // Both axes, one answer: a dependency the deployment does not offer is as
    // absent as one the operator switched off, and effective presence is where
    // the two are combined.
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'price_lists'));

    const res = await flip(MODULE, true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_DEPENDENCIES_ABSENT');
    expect(res.json().error.details.missing).toContain('price_lists');
  });

  it('does not refuse a switch-off for the module\'s own absent dependencies (T046)', async () => {
    // Only the *activating* direction reads dependencies. Refusing to switch a
    // module off because something it needs is already off would leave an
    // operator unable to tidy up after themselves.
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['price_lists'] });

    const res = await flip(MODULE, false);
    expect(res.statusCode).toBe(200);
    expect(res.json().module.activated).toBe(false);
  });

  it('stays reachable while the settings module is switched off (D-36)', async () => {
    // The property the relocation buys, and the reason Constitution XVII's
    // surface clause was amended. With the control on the Settings screen, this
    // state was the circle: no activation control reachable, including the one
    // that would switch Settings back on. The endpoint is kernel-resident, so
    // it answers whether or not the module that used to host its UI is present.
    // Written to the row rather than seeded into the cache: every activation
    // write refreshes the operator axis from the database afterwards, so a
    // seeded-only deactivation would quietly come back on at the first flip and
    // this case would stop testing what it says it does.
    await h.em().nativeUpdate(Setting, { code: 'settings.enabled' }, { globalValue: false });
    await registryCache.__refreshActivationForTesting(() => h.em());

    const presence = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/module-presence',
      cookies: ADMIN,
    });
    expect(presence.statusCode).toBe(200);
    expect(
      presence.json().modules.find((m: { id: string }) => m.id === 'settings'),
    ).toMatchObject({ present: false, activated: false });

    const res = await flip(MODULE, false);
    expect(res.statusCode).toBe(200);
    expect(res.json().module.activated).toBe(false);

    // The way back goes through `settings` first: `pim_ergonode` declares it, so
    // FR-008 refuses to switch a module on into a deployment that cannot serve
    // it. Both flips are served by this endpoint, which is the property the
    // relocation buys — the control that repairs the state is not inside the
    // module that is switched off.
    const blocked = await flip(MODULE, true);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('MODULE_DEPENDENCIES_ABSENT');

    expect((await flip('settings', true)).statusCode).toBe(200);
    expect((await flip(MODULE, true)).statusCode).toBe(200);
  });

  it('refuses the ordinary settings write path against an activation code', async () => {
    // FR-009: the audited Command is the only door. Without this guard an
    // operator could flip a module through the generic settings screen and
    // the flip would carry the hand-rolled, out-of-transaction audit shape.
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${PIM_ERGONODE_SETTING_CODES.ACTIVATION}/value`,
      cookies: ADMIN,
      payload: { scope: 'all', value: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('MODULE_ACTIVATION_PROTECTED');
  });

  it('refuses a per-channel write against an activation code', async () => {
    // Constitution XII: activation is platform-wide. A per-channel override
    // would make module presence channel-dependent through the back door, and
    // the hot-path check is deliberately not channel-aware.
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${PIM_ERGONODE_SETTING_CODES.ACTIVATION}/value`,
      cookies: ADMIN,
      payload: { scope: 'subset', salesChannelCodes: ['default'], value: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('MODULE_ACTIVATION_PROTECTED');
  });
});
