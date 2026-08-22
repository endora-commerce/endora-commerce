import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PIM_ERGONODE_SETTING_CODES } from '@endora-commerce/contracts';
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

/** Every module that declares the lock — the 23 the core set holds (feature 074). */
const CORE_IDS = REGISTERED_MANIFESTS.filter(
  (e) => e.manifest.activation !== undefined && 'nonDeactivatable' in e.manifest.activation,
).map((e) => e.manifest.id);

/**
 * The five controls feature 074 added. Named here so the contract cases below
 * read against the same list the manifest test pins, rather than a second copy
 * of it.
 */
const NEW_CONTROLS = ['blog', 'credentials', 'mfa', 'product_feeds', 'prompt_actions'] as const;

/** The four of those five that nothing present depends on, so a flip goes through. */
const FREELY_FLIPPABLE = ['blog', 'mfa', 'product_feeds', 'prompt_actions'] as const;

/**
 * Every registered module whose manifest names `moduleId` in `dependencies` —
 * i.e. exactly what the refusal below is computed from.
 *
 * Derived rather than written down (D-100). The two T045 cases used to carry a
 * hand-copied `['autopay', 'payu', 'stripe', 'tpay']`, which was correct until
 * `paypal` declared the same dependency and turned the pair red on `master`:
 * the switch-off case deactivated four of the five dependants and the fifth
 * went on blocking the flip. A hand-copied derived fact goes stale in silence,
 * and the gateway family is the part of this tree most likely to grow, so the
 * list is read from the manifests the endpoint itself reads.
 */
function dependantsOf(moduleId: string): string[] {
  const dependants = REGISTERED_MANIFESTS.filter((e) =>
    (e.manifest.dependencies ?? []).includes(moduleId),
  ).map((e) => e.manifest.id);

  // The floor, not decoration: with no dependants the switch-off case would
  // deactivate nothing and pass for the wrong reason, and the refusal case
  // would assert `arrayContaining([])`, which every array satisfies. Both
  // would be green over a manifest index that had stopped resolving.
  expect(
    dependants.length,
    `no registered manifest declares a dependency on ${moduleId}: both T045 cases ` +
      'would pass vacuously',
  ).toBeGreaterThan(0);

  return dependants;
}

/** Every activation code this file writes to, reset between cases. */
const WRITTEN_CODES = [
  PIM_ERGONODE_SETTING_CODES.ACTIVATION,
  'payments.enabled',
  'credentials.enabled',
  ...FREELY_FLIPPABLE.map((id) => activationCodeOf(id)),
];

function activationCodeOf(moduleId: string): string {
  const activation = REGISTERED_MANIFESTS.find((e) => e.manifest.id === moduleId)?.manifest
    .activation;
  if (!activation || 'nonDeactivatable' in activation) {
    throw new Error(`${moduleId} declares no operator activation control`);
  }
  return activation.settingCode;
}

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
      { code: { $in: WRITTEN_CODES } },
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

  it.each(CORE_IDS)(
    'refuses to switch the core module %s off, with its own declared reason (074)',
    async (moduleId) => {
      // SC-009, the operator half. Feature 073 refused `settings` here with
      // `MODULE_DEPENDENTS_PRESENT` — "not in this order", naming
      // `organizations` — which was an accidental guard assembled out of what
      // other modules had written about themselves. Ruling 2 withdraws that
      // authority, so the refusal has to come from the module's own manifest or
      // not at all, and this asserts it does for all twenty-three.
      const declared = REGISTERED_MANIFESTS.find((e) => e.manifest.id === moduleId);
      const reason = (declared?.manifest.activation as { reason?: string } | undefined)?.reason;
      expect(reason, `${moduleId} declares no non-deactivatable reason`).toBeTruthy();

      const res = await flip(moduleId, false);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('MODULE_NOT_DEACTIVATABLE');
      expect(res.json().error.message).toBe(reason);
    },
  );

  it('refuses a hub on its own declaration, not on a dependent\'s (FR-047)', async () => {
    // The sequencing property, at the door an operator actually reaches.
    // `settings` is named by dozens of manifests for a capability the kernel has
    // served since D-32, and those declarations were the only thing refusing
    // this flip. Deleting them — Phase 3, a commit whose message says "hygiene"
    // — must not turn `settings.enabled` into a live control, and the code
    // returned here is what proves the refusal no longer depends on them.
    const res = await flip('settings', false);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_NOT_DEACTIVATABLE');
    expect(res.json().error.code).not.toBe('MODULE_DEPENDENTS_PRESENT');
    expect(res.json().error.details?.blockedBy).toBeUndefined();
  });

  it('switches a module off once nothing effectively present depends on it (T045)', async () => {
    // The refusal follows *effective presence*, not the graph: with every
    // dependent absent from this deployment the flip is ordinary again. This is
    // also the remedy the message describes — switch the dependents off first.
    //
    // Re-pointed by feature 074 from `price_lists`, which is now core, onto the
    // spec's own example: a client selling on 30-day credit terms who takes no
    // online payment, with the gateway modules that resolve `payments`.
    const dependents = dependantsOf('payments');
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => !dependents.includes(id)));

    const res = await flip('payments', false);
    expect(res.statusCode).toBe(200);
    expect(res.json().module.activated).toBe(false);
  });

  it('still refuses that flip while the dependents are present (T045)', async () => {
    // The other side of the same pair, and the state User Story 1 of feature
    // 074 replaces with an informed confirmation in Phase 2. Asserted now so
    // that the change of code is visible in the diff when it happens.
    const res = await flip('payments', false);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_DEPENDENTS_PRESENT');
    // The same derivation as the case above, and the second copy of the list
    // that went stale: this one survived `paypal` only because
    // `arrayContaining` is a subset check, so it asserted four fifths of the
    // property and reported nothing about the fifth.
    expect(res.json().error.details.blockedBy).toEqual(
      expect.arrayContaining(dependantsOf('payments')),
    );
  });

  it('refuses to switch a module on while a module it needs is switched off (T046)', async () => {
    // The symmetric direction, unchanged in meaning and re-pointed by feature
    // 074: `pim_ergonode` used to be paired with `price_lists`, which is now
    // core and can no longer be seeded as deactivated at all. `credentials` is
    // the honest replacement — the connector's API credentials live there, and
    // it is one of the five modules 074 gives a control to, so the pairing also
    // proves that control reaches the graph.
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['credentials'] });

    const res = await flip(MODULE, true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_DEPENDENCIES_ABSENT');
    expect(res.json().error.message).toContain('credentials');
    expect(res.json().error.details.missing).toContain('credentials');
  });

  it('refuses to switch a module on while a module it needs is not installed here (T046)', async () => {
    // Both axes, one answer: a dependency the deployment does not offer is as
    // absent as one the operator switched off, and effective presence is where
    // the two are combined.
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'credentials'));

    const res = await flip(MODULE, true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_DEPENDENCIES_ABSENT');
    expect(res.json().error.details.missing).toContain('credentials');
  });

  it('does not refuse a switch-off for the module\'s own absent dependencies (T046)', async () => {
    // Only the *activating* direction reads dependencies. Refusing to switch a
    // module off because something it needs is already off would leave an
    // operator unable to tidy up after themselves.
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['credentials'] });

    const res = await flip(MODULE, false);
    expect(res.statusCode).toBe(200);
    expect(res.json().module.activated).toBe(false);
  });

  it('cannot be driven into the D-36 circle at all any more (074)', async () => {
    // What this case used to assert: with `settings` switched off, the
    // activation endpoint still answers, because D-36 moved it out of the
    // module whose UI used to host it. The property is still true and still
    // matters — it is why switching `settings` off was survivable — but feature
    // 074 removes the premise. `settings` is core, so the state is unreachable
    // from this door, and the honest assertion is that the flip is refused and
    // the projection renders a lock rather than a dead toggle.
    const reason = (
      REGISTERED_MANIFESTS.find((e) => e.manifest.id === 'settings')?.manifest.activation as
        | { reason?: string }
        | undefined
    )?.reason;

    const refused = await flip('settings', false);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('MODULE_NOT_DEACTIVATABLE');
    expect(refused.json().error.message).toBe(reason);

    const presence = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/module-presence',
      cookies: ADMIN,
    });
    expect(presence.statusCode).toBe(200);
    expect(
      presence.json().modules.find((m: { id: string }) => m.id === 'settings'),
    ).toMatchObject({
      present: true,
      activated: true,
      deactivatable: false,
      nonDeactivatableReason: reason,
    });

    // And the endpoint keeps serving an unrelated module's flip while it does,
    // which is the half of the old case that survives: this door is
    // kernel-resident and depends on no module's presence.
    expect((await flip(MODULE, false)).statusCode).toBe(200);
    expect((await flip(MODULE, true)).statusCode).toBe(200);
  });

  it.each(NEW_CONTROLS)('%s now reports an operator control it never had (FR-011)', async (id) => {
    const presence = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/module-presence',
      cookies: ADMIN,
    });
    expect(
      presence.json().modules.find((m: { id: string }) => m.id === id),
    ).toMatchObject({ deactivatable: true, nonDeactivatableReason: null, activated: true });
  });

  it.each(FREELY_FLIPPABLE)('%s can be switched off and back on (FR-011, FR-012)', async (id) => {
    // `activated: true` before the first flip is the FR-012 claim measured at
    // the endpoint: all five default to on, so merging the new control changes
    // no deployment's state.
    const off = await flip(id, false);
    expect(off.statusCode).toBe(200);
    expect(off.json().module).toMatchObject({ activated: false, present: false });

    const on = await flip(id, true);
    expect(on.statusCode).toBe(200);
    expect(on.json().module).toMatchObject({ activated: true, present: true });
  });

  it('`credentials` gains a live control that its dependents still block (FR-011)', async () => {
    // The fifth of the five, kept separate because five modules resolve it. The
    // refusal is the pre-Phase-2 behaviour and is asserted rather than avoided:
    // the point of the new declaration is that the control is *reached* at all,
    // and until this module had one the flip answered "declares no activation
    // control" instead.
    const res = await flip('credentials', false);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('MODULE_DEPENDENTS_PRESENT');
    expect(res.json().error.details.blockedBy).toEqual(
      expect.arrayContaining(['pim_ergonode', 'prompt_actions']),
    );
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
