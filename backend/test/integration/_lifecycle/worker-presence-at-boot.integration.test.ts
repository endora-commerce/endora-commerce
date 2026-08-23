import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest, RegistryState } from '@endora-commerce/contracts';
import { defineModuleWorker } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  loadModulePresence,
  type ShippedModuleEntry,
} from '../../../src/modules/_lifecycle/services/presence-load.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { coreModulesRoot } from '../../../src/overlay/overlay-roots.js';

/**
 * A worker's pause decision at a **fresh boot** (feature 073, Amendment A2-Q2;
 * feature 072, D-38).
 *
 * `_lifecycle`'s plugin used to close its boot half with
 * `for (const moduleId of registryCache.enabledIds()) await resumeWorkersFor(moduleId)`.
 * It existed only to undo the pauses a cold presence cache caused — every module
 * read as absent at registration, so `defineModuleWorker` paused every worker —
 * and it iterated `enabledIds()`, which is the **platform axis alone**. A module
 * that is installed and operator-**deactivated** therefore had its BullMQ
 * consumers resumed at every boot and went on draining its queue while the Admin
 * UI showed it off.
 *
 * D-38 deleted the loop rather than correcting it: with presence loaded before
 * the first module registers, each pause decision is already right when it is
 * taken. That makes "a deactivated module's workers are paused after a fresh
 * boot" true **by construction** — and nothing asserted it, because every other
 * worker off-state test (`disable-pauses-workers`, `wrapper-effective-state`)
 * deactivates a module in an already-running process, which is the one ordering
 * this bug never affected.
 *
 * **Why here and not in `test/integration/kernel/production-boot.test.ts`.**
 * That file boots the real composition root against the real registry, where no
 * module is deactivated; asserting this there would mean deactivating a module
 * and booting a second time, and one production boot per suite run is the whole
 * budget D-40 allocates. What is under test is the `defineModuleWorker` seam
 * under the boot **ordering**, which is exactly what the three sibling files in
 * this directory cover for the other transitions — so it belongs beside them,
 * with the same in-memory worker stub.
 *
 * The boot sequence is the real one: `loadModulePresence()` (the composition
 * step, against a stubbed `EntityManager` — it makes two `find` calls and no
 * more) and then `defineModuleWorker`, in that order, with the cache genuinely
 * unloaded beforehand.
 */

const ACTIVE = 'fixture_boot_worker_active';
const DEACTIVATED = 'fixture_boot_worker_deactivated';
const UNINSTALLED = 'fixture_boot_worker_uninstalled';

function manifest(id: string): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    dependencies: [],
    activation: { settingCode: `${id}.enabled`, default: true },
  };
}

/**
 * Core entries: `loadModulePresence` takes the resolved entries and derives each
 * one's origin from its `filePath` (D-157.6(b)), so a fixture that wants a row
 * reconciled has to anchor where a core module anchors.
 */
function entry(id: string): ShippedModuleEntry {
  return {
    manifest: manifest(id),
    filePath: join(coreModulesRoot(), id, 'manifest.ts'),
    origin: 'core',
  };
}

const ENTRIES = [entry(ACTIVE), entry(DEACTIVATED), entry(UNINSTALLED)];

/** The two reads the load makes: the platform axis, then the operator axis. */
function stubEm(rows: {
  registrations: ReadonlyArray<{ moduleId: string; state: RegistryState }>;
  settings?: ReadonlyArray<{ code: string; globalValue: unknown }>;
}): () => EntityManager {
  return () =>
    ({
      find: async (entity: unknown): Promise<unknown[]> => {
        if (entity === ModuleRegistration) return [...rows.registrations];
        if (entity === Setting) {
          return (rows.settings ?? []).map((s) => ({
            code: s.code,
            globalValue: s.globalValue,
            defaultValue: null,
          }));
        }
        return [];
      },
      create: (_entity: unknown, data: unknown): unknown => data,
      flush: async (): Promise<void> => {},
    }) as unknown as EntityManager;
}

type FakeWorker = { pause: () => Promise<void>; resume: () => Promise<void> };

/**
 * One module's fresh boot: presence loaded from the database first, then the
 * module registers its worker. `paused` is what the boot left behind.
 */
async function bootAndRegisterWorker(
  moduleId: string,
  rows: Parameters<typeof stubEm>[0],
): Promise<{ paused: boolean }> {
  registryCache.__resetForTesting();
  await loadModulePresence({ em: stubEm(rows), entries: ENTRIES });

  const state = { paused: false };
  const worker: FakeWorker = {
    pause: async () => {
      state.paused = true;
    },
    resume: async () => {
      state.paused = false;
    },
  };
  defineModuleWorker(moduleId, worker as never);
  // `defineModuleWorker` pauses with `void worker.pause()`; let the microtask run.
  await Promise.resolve();
  return state;
}

describe('defineModuleWorker — the pause decision at a fresh boot (integration)', () => {
  beforeEach(() => {
    registryCache.__resetForTesting();
  });

  afterAll(() => {
    // Process singleton, one fork: leave it loaded, the way every other file
    // expects to find it.
    registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((e) => e.manifest.id));
  });

  it('leaves the worker of a fully present module running — there is nothing to resume', async () => {
    const state = await bootAndRegisterWorker(ACTIVE, {
      registrations: [{ moduleId: ACTIVE, state: 'installed' }],
    });

    // This is the property that made deleting the resume loop safe. If presence
    // is ever loaded after composition again, this worker starts paused and
    // stays paused for the process lifetime — its queue silently never drains.
    expect(state.paused).toBe(false);
  });

  it('pauses the worker of a platform-available but operator-deactivated module', async () => {
    const state = await bootAndRegisterWorker(DEACTIVATED, {
      registrations: [{ moduleId: DEACTIVATED, state: 'installed' }],
      settings: [{ code: `${DEACTIVATED}.enabled`, globalValue: false }],
    });

    expect(state.paused).toBe(true);
    // …and this is precisely the case the deleted loop got wrong: the platform
    // axis says "installed", so `enabledIds()` — what the loop iterated — still
    // names this module. Only the effective state, which is what
    // `defineModuleWorker` asks, says absent.
    expect(registryCache.enabledIds()).toContain(DEACTIVATED);
    expect(registryCache.activationValue(DEACTIVATED)).toBe(false);
  });

  it('pauses the worker of a module that is not available on this platform', async () => {
    const state = await bootAndRegisterWorker(UNINSTALLED, {
      registrations: [{ moduleId: UNINSTALLED, state: 'disabled' }],
    });

    expect(state.paused).toBe(true);
    expect(registryCache.enabledIds()).not.toContain(UNINSTALLED);
  });
});
