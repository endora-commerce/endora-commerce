import { describe, expect, it } from 'vitest';
import {
  defineModuleManifest,
  type ModuleHardUninstalledEvent,
  type ModuleInstalledEvent,
  type ModuleLifecycleParticipant,
} from '@endora-commerce/contracts';
import {
  type LoadedLifecycleParticipant,
  type LoadedManifestRegistry,
  ModuleDepGraph,
  ModuleLifecycleOrchestrator,
} from '@endora-commerce/platform/lifecycle';
import { migrationOwnershipOf } from '../../../src/db/configured-migrations.js';

/**
 * Feature 080, T036a / D-159 — the reconcile is a **manifest export the
 * orchestrator collects**, not a service a composition root hands it.
 *
 * The defect this closes: `lifecycleModule` handed the orchestrator an
 * `i18nReconciler` and an `adminActionsReconciler`, both optional on
 * `OrchestratorDeps` and both **skipped when absent**, and none of the five
 * `module:*` CLI scripts passed either. So `module:install X` from a terminal
 * installed no translation bundle and reconciled no palette action while the
 * same install from `/platform/modules` did — one question, two answers, which
 * is the condition this programme exists to remove.
 *
 * The three properties asserted here are the ones that make the repair a repair
 * rather than a relocation:
 *
 *  1. a participant runs for **another** module's install (an install hook runs
 *     for its own, which is why one could not be used);
 *  2. it runs on a hard uninstall and **not** on a soft one — the case with no
 *     other cure, since `uninstall --hard` followed by `pnpm remove` orphans
 *     the rows permanently and no boot pass will ever see the manifest again;
 *  3. a registry that **cannot answer** refuses the operation, while one that
 *     answers *"no module declares a participant"* proceeds in silence. Those
 *     are two different facts and the optional-and-skip shape collapsed them —
 *     the fail-open `src/db/configured-migrations.ts` names in its own comment.
 */

interface FakeRow {
  moduleId: string;
  state: string;
  version: string;
  installedAt: Date;
  lastStateChangeAt: Date;
  lastInstallFailedAt: Date | null;
  lastInstallError: string | null;
}

class FakeEm {
  rows: FakeRow[] = [];
  async find(_entity: unknown, where: Record<string, unknown> = {}): Promise<FakeRow[]> {
    return this.rows.filter((r) => {
      for (const [k, v] of Object.entries(where)) {
        const rv = (r as unknown as Record<string, unknown>)[k];
        if (v && typeof v === 'object' && '$in' in (v as object)) {
          if (!(v as { $in: string[] }).$in.includes(rv as string)) return false;
        } else if (rv !== v) return false;
      }
      return true;
    });
  }
  async findOne(_entity: unknown, where: { moduleId: string }): Promise<FakeRow | null> {
    return this.rows.find((r) => r.moduleId === where.moduleId) ?? null;
  }
  async flush(): Promise<void> {}
  async persistAndFlush(payload: FakeRow): Promise<void> {
    this.rows.push(payload);
  }
  remove(payload: FakeRow): void {
    this.rows = this.rows.filter((r) => r !== payload);
  }
  async removeAndFlush(payload: FakeRow): Promise<void> {
    this.remove(payload);
  }
  create(_entity: unknown, payload: FakeRow): FakeRow {
    return payload;
  }
}

class FakeRedis {
  store = new Map<string, string>();
  async set(key: string, value: string): Promise<'OK' | null> {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async eval(script: string, _n: number, key: string, expected: string): Promise<number> {
    if (script.includes('del') && this.store.get(key) === expected) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
  async publish(): Promise<number> {
    return 0;
  }
}

class FakeAuditLog {
  async record(): Promise<void> {}
}

/** A participant that records what it was told, so the events can be asserted. */
function recordingParticipant(): {
  participant: ModuleLifecycleParticipant;
  installed: ModuleInstalledEvent[];
  removed: ModuleHardUninstalledEvent[];
} {
  const installed: ModuleInstalledEvent[] = [];
  const removed: ModuleHardUninstalledEvent[] = [];
  return {
    installed,
    removed,
    participant: {
      async onModuleInstalled(event) {
        installed.push(event);
      },
      async onModuleHardUninstalled(event) {
        removed.push(event);
      },
    },
  };
}

function buildRegistry(
  ids: readonly string[],
  participants: readonly LoadedLifecycleParticipant[] | null,
): LoadedManifestRegistry {
  const modules = new Map<string, { manifest: ReturnType<typeof defineModuleManifest>; filePath: string }>();
  for (const id of ids) {
    modules.set(id, {
      manifest: defineModuleManifest({
        id,
        name: id,
        version: '1.0.0',
        dependencies: [],
      }),
      filePath: `/fixtures/${id}/manifest.ts`,
    });
  }
  const graph = new ModuleDepGraph([...modules.values()].map((e) => e.manifest));
  return { modules: modules as never, graph, participants };
}

function buildOrchestrator(
  registry: LoadedManifestRegistry,
  em = new FakeEm(),
  alsoCovered: readonly string[] = [],
) {
  const migrator = { getPendingMigrations: async () => [], up: async () => [], down: async () => [] };
  return {
    em,
    orchestrator: new ModuleLifecycleOrchestrator({
      orm: {} as never,
      redis: new FakeRedis() as never,
      em: () => em as never,
      auditLog: new FakeAuditLog() as never,
      registry,
      // Every module this registry holds is covered and owns no migration —
      // the statement T033 made a hard uninstall require. `alsoCovered` is for
      // the orphan case, whose whole point is a row with no manifest.
      migrationOwnership: migrationOwnershipOf([], [...registry.modules.keys(), ...alsoCovered]),
      migratorFor: async () => migrator as never,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    }),
  };
}

describe('lifecycle participants — collected from the manifest registry', () => {
  it('runs every declared participant on ANOTHER module\'s install', async () => {
    const i18nish = recordingParticipant();
    const paletteish = recordingParticipant();
    const registry = buildRegistry(['_i18n', 'admin_actions', 'orders'], [
      { moduleId: '_i18n', participant: i18nish.participant },
      { moduleId: 'admin_actions', participant: paletteish.participant },
    ]);
    const { orchestrator, em } = buildOrchestrator(registry);

    await orchestrator.install('orders');

    expect(i18nish.installed.map((e) => e.moduleId)).toEqual(['orders']);
    expect(paletteish.installed.map((e) => e.moduleId)).toEqual(['orders']);
    // The manifest the participant projects, and the directory it reads the
    // module's own files from — `dirname` of the manifest path, which is what
    // an on-disk bundle directory is joined onto.
    expect(i18nish.installed[0]?.manifest.id).toBe('orders');
    expect(i18nish.installed[0]?.modulePath).toBe('/fixtures/orders');
    // The orchestrator's EntityManager, not a fork the participant made for
    // itself: that is what puts the projection's rows in the operation rather
    // than beside it.
    expect(i18nish.installed[0]?.em).toBe(em);
  });

  it('runs a participant for its own module too', async () => {
    const i18nish = recordingParticipant();
    const registry = buildRegistry(['_i18n'], [
      { moduleId: '_i18n', participant: i18nish.participant },
    ]);
    const { orchestrator } = buildOrchestrator(registry);

    await orchestrator.install('_i18n');

    expect(i18nish.installed.map((e) => e.moduleId)).toEqual(['_i18n']);
  });

  it('aborts the install when a participant throws (FR-016)', async () => {
    const registry = buildRegistry(['_i18n', 'orders'], [
      {
        moduleId: '_i18n',
        participant: {
          onModuleInstalled: async () => {
            throw new Error('bundle for "orders" is not valid JSON');
          },
          onModuleHardUninstalled: async () => {},
        },
      },
    ]);
    const { orchestrator, em } = buildOrchestrator(registry);

    await expect(orchestrator.install('orders')).rejects.toThrow(/not valid JSON/);
    expect(em.rows.find((r) => r.moduleId === 'orders')?.state).toBe('uninstalled');
  });

  it('removes on a HARD uninstall and leaves a soft one alone', async () => {
    const paletteish = recordingParticipant();
    const registry = buildRegistry(['admin_actions', 'orders'], [
      { moduleId: 'admin_actions', participant: paletteish.participant },
    ]);
    const em = new FakeEm();
    const { orchestrator } = buildOrchestrator(registry, em);

    await orchestrator.install('orders');
    await orchestrator.uninstall('orders', { hard: false });
    expect(paletteish.removed).toHaveLength(0);

    await orchestrator.install('orders');
    await orchestrator.uninstall('orders', { hard: true });
    expect(paletteish.removed.map((e) => e.moduleId)).toEqual(['orders']);
    expect(paletteish.removed[0]?.em).toBe(em);
  });

  it('hard-uninstalls an ORPHAN row, whose manifest this instance no longer has', async () => {
    // The case with no other cure: `module:uninstall @vendor/x --hard` followed
    // by `pnpm remove @vendor/x`. Both boot reconcilers iterate the manifest
    // registry, so once the manifest is gone no boot pass will ever remove the
    // rows it left behind.
    const paletteish = recordingParticipant();
    const registry = buildRegistry(['admin_actions'], [
      { moduleId: 'admin_actions', participant: paletteish.participant },
    ]);
    const em = new FakeEm();
    em.rows.push({
      moduleId: 'vendor_gone',
      state: 'installed',
      version: '1.0.0',
      installedAt: new Date(),
      lastStateChangeAt: new Date(),
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    const { orchestrator } = buildOrchestrator(registry, em, ['vendor_gone']);

    await orchestrator.uninstall('vendor_gone', { hard: true });

    expect(paletteish.removed.map((e) => e.moduleId)).toEqual(['vendor_gone']);
    expect(paletteish.removed[0]?.manifest).toBeNull();
  });

  describe('a registry that cannot answer refuses; one that answers "none" proceeds', () => {
    it('installs in silence when no module declares a participant', async () => {
      const registry = buildRegistry(['orders'], []);
      const { orchestrator } = buildOrchestrator(registry);

      await expect(orchestrator.install('orders')).resolves.toMatchObject({
        state: 'installed',
      });
    });

    it('refuses an install over a registry whose participants are unknown', async () => {
      const registry = buildRegistry(['orders'], null);
      const { orchestrator, em } = buildOrchestrator(registry);

      await expect(orchestrator.install('orders')).rejects.toThrow(
        /cannot enumerate the lifecycle participants/i,
      );
      // Refused before the registration row moved — the point of refusing at
      // the top rather than after the write.
      expect(em.rows).toHaveLength(0);
    });

    it('refuses a hard uninstall over a registry whose participants are unknown', async () => {
      const registry = buildRegistry(['orders'], null);
      const em = new FakeEm();
      em.rows.push({
        moduleId: 'orders',
        state: 'installed',
        version: '1.0.0',
        installedAt: new Date(),
        lastStateChangeAt: new Date(),
        lastInstallFailedAt: null,
        lastInstallError: null,
      });
      const { orchestrator } = buildOrchestrator(registry, em);

      await expect(orchestrator.uninstall('orders', { hard: true })).rejects.toThrow(
        /cannot enumerate the lifecycle participants/i,
      );
      expect(em.rows).toHaveLength(1);
    });

    it('lets a SOFT uninstall through, because no participant would have run', async () => {
      const registry = buildRegistry(['orders'], null);
      const em = new FakeEm();
      em.rows.push({
        moduleId: 'orders',
        state: 'installed',
        version: '1.0.0',
        installedAt: new Date(),
        lastStateChangeAt: new Date(),
        lastInstallFailedAt: null,
        lastInstallError: null,
      });
      const { orchestrator } = buildOrchestrator(registry, em);

      await expect(orchestrator.uninstall('orders', { hard: false })).resolves.toMatchObject({
        state: 'uninstalled',
      });
    });
  });
});
