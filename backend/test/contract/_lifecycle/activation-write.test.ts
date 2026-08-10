import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PIM_ERGONODE_SETTING_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';
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
 * absent) belong to US2 and land with T044–T046.
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
    await em.nativeUpdate(
      Setting,
      { code: PIM_ERGONODE_SETTING_CODES.ACTIVATION },
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
