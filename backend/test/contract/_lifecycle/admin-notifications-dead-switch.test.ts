import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AdminNotificationRecordPort, ModuleManifest } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { lazyPort, type ModuleContext } from '../../../src/kernel/index.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { presenceAwareBulkRecorder } from '../../../../packages/modules/catalog/dist/backend/services/bulk-operation.service.js';
import type { OrgRegistrationNotifier } from '../../../../packages/modules/organizations/src/backend/services/org-registration-notifier.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { TEST_RESTRICTED_ADMIN_ID } from '../../helpers/seed-admins.js';

/**
 * D-179.3 — `admin_notifications.enabled` stops being a dead switch, and the
 * two consumers that made it one are re-classified in *opposite* directions.
 *
 * `catalog` and `organizations` both declared `admin_notifications` in
 * `dependencies`, both are non-deactivatable, and `ModuleGatingGraph` builds
 * `dependentsOf` from that array — so the activation Command answered 409
 * naming two modules that can never go away. Neither declaration was doing any
 * work: there is no foreign key into either `admin_notification` table from
 * either consumer, and each already had a *decided* answer for the owner's
 * absence, written in its own code under a ruling of its own:
 *
 *  - `catalog` composes `presenceAwareBulkRecorder` (D-60), which decides
 *    presence in front of the gate and hands the bulk-operation service
 *    `'not-present'` in the return type — so the edge degrades.
 *  - `organizations` calls `rethrowIfModuleDisabled` first in the notifier's
 *    catch (D-88), so a registration nobody was told about surfaces as a
 *    refusal rather than as a silent success — so the edge refuses.
 *
 * The point of the change is operator-visible, so it is asserted at the door an
 * operator reaches — the real endpoint, the real presence projection, the real
 * container seam — rather than by stubbing the gating graph.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const OWNER = 'admin_notifications';
const PORT = 'adminNotificationRecordPort';

const MANIFESTS: readonly ModuleManifest[] = REGISTERED_MANIFESTS.map((entry) => entry.manifest);
const ALL_IDS = MANIFESTS.map((manifest) => manifest.id);

function manifestOf(moduleId: string): ModuleManifest {
  const found = MANIFESTS.find((manifest) => manifest.id === moduleId);
  if (!found) throw new Error(`no manifest for '${moduleId}'`);
  return found;
}

/**
 * Every module the flip-time refusal would name, derived from the manifests the
 * endpoint itself reads rather than copied (D-100).
 */
function bindersOf(owner: string): string[] {
  return MANIFESTS.filter(
    (manifest) =>
      (manifest.dependencies ?? []).includes(owner) ||
      (manifest.acknowledgedDependencies ?? []).some((edge) => edge.moduleId === owner),
  )
    .map((manifest) => manifest.id)
    .sort();
}

function isLocked(moduleId: string): boolean {
  const activation = manifestOf(moduleId).activation;
  return activation !== undefined && 'nonDeactivatable' in activation;
}

function activationCodeOf(moduleId: string): string {
  const activation = manifestOf(moduleId).activation;
  if (activation === undefined || !('settingCode' in activation)) {
    throw new Error(`'${moduleId}' declares no activation setting code`);
  }
  return activation.settingCode;
}

/** The activation settings this file touches — owner plus whatever still binds it. */
const ACTIVATION_CODES = [OWNER, ...bindersOf(OWNER).filter((id) => !isLocked(id))].map(
  activationCodeOf,
);

/**
 * The container read `lazyPort` performs on every method call. Written out
 * rather than helper-wrapped because it *is* the seam under test: a gated
 * registration is a transient whose factory asks the owner's effective state,
 * so the throw lands here, before any implementation runs.
 */
function resolvePort(h: BackendServerHandle, name: string): unknown {
  return (h.container.cradle as unknown as Record<string, unknown>)[name];
}

describe('admin_notifications.enabled is a live control [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  afterEach(async () => {
    await h.em().nativeUpdate(Setting, { code: { $in: ACTIVATION_CODES } }, { globalValue: null });
    registryCache.__setEnabledForTesting(ALL_IDS);
    await h
      .em()
      .execute('delete from admin_notifications where kind = ?', ['test.dead_switch.probe']);
  });

  async function flip(moduleId: string, active: boolean) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${moduleId}/activation`,
      cookies: ADMIN,
      payload: { active },
    });
  }

  async function presenceOf(moduleId: string) {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/module-presence',
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { modules: Array<{ id: string }> }).modules.find(
      (module) => module.id === moduleId,
    );
  }

  /**
   * The operator's own path to switching the bell off: everything that still
   * binds it goes first, and every one of those is a module they can switch.
   * That is exactly what the two re-classifications buy — before them this
   * loop had to switch off `catalog` and `organizations`, which refuse.
   */
  async function switchOwnerOff() {
    for (const binder of bindersOf(OWNER)) {
      const res = await flip(binder, false);
      expect(res.statusCode, `switching '${binder}' off`).toBe(200);
    }
    const res = await flip(OWNER, false);
    expect(res.statusCode, `switching '${OWNER}' off`).toBe(200);
    return res;
  }

  /** Catalog's own composition, assembled over this container's real port. */
  function catalogRecorder() {
    const ctx = {
      cradle: () => h.container.cradle,
      module: { id: 'catalog' },
    } as unknown as ModuleContext;
    return presenceAwareBulkRecorder(lazyPort<AdminNotificationRecordPort>(ctx, PORT));
  }

  function notifier(): OrgRegistrationNotifier {
    const resolved = (
      h.container.cradle as unknown as Record<string, OrgRegistrationNotifier | undefined>
    ).organizationRegistrationNotifier;
    // Never defaulted: an absent notifier would make every assertion below
    // pass against nothing (issue #159).
    if (!resolved) throw new Error('organizationRegistrationNotifier is not registered');
    return resolved;
  }

  it('resolves the record port while the module is on (the positive control)', () => {
    // Without this, every assertion below would pass against a name nothing
    // registers — the throw would be the wrong one and read the same.
    expect(resolvePort(h, PORT)).toBeDefined();
  });

  it('is bound by no module an operator cannot switch off', () => {
    // The derivation D-179.1 used to find the dead switches, run against the
    // manifests the endpoint itself reads. A locked binder is a refusal that
    // names a module which will never go away.
    expect(bindersOf(OWNER).filter(isLocked)).toEqual([]);
  });

  it('switches off where it used to answer 409', async () => {
    const res = await switchOwnerOff();
    expect(res.json().module).toMatchObject({
      id: OWNER,
      activated: false,
      present: false,
      deactivatable: true,
    });
  });

  it('takes the module out of the presence projection', async () => {
    await switchOwnerOff();
    expect(await presenceOf(OWNER)).toMatchObject({ present: false, activated: false });
  });

  it('refuses at the port seam instead of half-executing', async () => {
    await switchOwnerOff();
    expect(() => resolvePort(h, PORT)).toThrow(ModuleDisabledError);
  });

  it('makes the refusing consumer refuse: a registration nobody was told about (D-88)', async () => {
    // `organizations` is the `refuses-without` half. The notifier's catch
    // re-throws `ModuleDisabledError` first, so the operator's choice surfaces
    // instead of being absorbed by the best-effort tolerance around it.
    await switchOwnerOff();
    await expect(notifier().handleRegistered(TEST_ORGANIZATION_ID)).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });

  it('makes the degrading consumer degrade: not-present in the return type (D-60)', async () => {
    // `catalog` is the `degrades-without` half. Absence is decided in front of
    // the gate, so the bulk operation still finishes and the caller can tell
    // the operator's choice from a failed write.
    const recorder = catalogRecorder();
    await switchOwnerOff();
    await expect(
      recorder.record({
        audience: 'admin_user',
        targetAdminUserId: TEST_RESTRICTED_ADMIN_ID,
        kind: 'test.dead_switch.probe',
        title: 'Bulk edit finished',
      }),
    ).resolves.toBe('not-present');
  });

  it('leaves both dependents serving while the bell is off', async () => {
    // What the two non-binding kinds claim together: the operation that touches
    // the owner answers for itself, and neither declaring module stops.
    await switchOwnerOff();
    for (const url of [
      '/api/v1/admin/catalog/bulk-operations?limit=1',
      '/api/v1/admin/organizations?limit=1',
    ]) {
      const res = await h.app.inject({ method: 'GET', url, cookies: ADMIN });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('persists the operator choice and gives the capability back', async () => {
    await switchOwnerOff();

    const em = h.em();
    em.clear();
    expect(
      (await em.findOne(Setting, { code: activationCodeOf(OWNER) }))?.globalValue,
      'the choice lives in the settings store, not in module_registrations',
    ).toBe(false);
    // The platform axis is untouched: switching off is not uninstalling.
    expect(registryCache.isEnabled(OWNER)).toBe(true);
    expect(registryCache.platformStateOf(OWNER)).toBe('installed');

    const on = await flip(OWNER, true);
    expect(on.statusCode).toBe(200);
    expect(on.json().module).toMatchObject({ activated: true, present: true });
    expect(resolvePort(h, PORT)).toBeDefined();

    // The degrading consumer records again, and the refusing one stops refusing.
    await expect(
      catalogRecorder().record({
        audience: 'admin_user',
        targetAdminUserId: TEST_RESTRICTED_ADMIN_ID,
        kind: 'test.dead_switch.probe',
        title: 'Bulk edit finished',
      }),
    ).resolves.toBe('recorded');
    await expect(notifier().handleRegistered(TEST_ORGANIZATION_ID)).resolves.toBeUndefined();

    // And every binder comes back — one at a time, each switched off again
    // before the next, so that at most one of them is on at any moment.
    //
    // This loop switched them **all** on and left them on until 2026-09-06.
    // That asserted more than the file's subject and, since `pim_unopim`
    // landed (feature 089, 2026-09-02), asserted something the platform
    // refuses: `pim_ergonode` and `pim_unopim` are mutually exclusive PIM
    // connectors (FR-003), so with `pim_ergonode` restored one iteration
    // earlier the second flip is a correct 409 `PIM_CONNECTOR_ALREADY_ACTIVE`
    // — a refusal raised by a `pim_unopim` interceptor, about the PIM family,
    // asserted on its own terms in
    // `test/integration/pim_unopim/connector-exclusion.test.ts`, and saying
    // nothing whatever about the bell. The harness could *seed* both connectors
    // activated (`__setEnabledForTesting` seeds every module's operator axis to
    // `true`, whatever its manifest default) and the API will not re-create
    // that state, which is the API being right.
    //
    // Restoring them one at a time is the stronger claim as well as the
    // achievable one: it proves each binder individually is switchable again,
    // where the old loop proved only that the set could be walked in sorted
    // order. It names no module and encodes no other module's rules, so the
    // next exclusive family costs this file nothing.
    for (const binder of bindersOf(OWNER)) {
      const on = await flip(binder, true);
      expect(on.statusCode, `switching '${binder}' back on`).toBe(200);
      expect(await presenceOf(binder)).toMatchObject({ present: true, activated: true });

      const off = await flip(binder, false);
      expect(off.statusCode, `parking '${binder}' before the next binder`).toBe(200);
    }
  });
});
