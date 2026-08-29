import { describe, it, expect } from 'vitest';
import { defineModuleManifest, type ModuleActivation } from '@endora-commerce/contracts';
import { ModuleLifecycleOrchestrator, LifecycleError } from '../../../src/lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/lifecycle/services/dep-graph.js';
import type { LoadedManifestRegistry } from '../../../src/lifecycle/services/manifest-loader.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import {
  migrationOwnershipOf,
  type MigrationOwnership,
} from '../../../src/db/configured-migrations.js';

/**
 * Orchestrator — pure-logic unit tests against in-memory stubs.
 *
 * Constitution III bans DB mocking in *integration* tests but is
 * silent on unit tests. This file exercises the orchestrator's
 * dependency-validation, lock acquisition, and audit-log paths
 * against a faked EntityManager / Migrator / Redis. Integration
 * tests against a real Postgres + Redis live in
 * `test/integration/_lifecycle/`.
 *
 * The most critical contract under test here is SC-002: 100% of
 * failed installs leave the instance in pre-install state. A forced
 * install-hook failure must trigger migration revert AND must NOT
 * persist the registry row.
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
  ops: Array<{ kind: string; payload: unknown }> = [];
  constructor(seed: FakeRow[] = []) {
    this.rows = [...seed];
  }
  async find(_entity: unknown, where: Record<string, unknown> = {}): Promise<FakeRow[]> {
    return this.rows.filter((r) => {
      for (const [k, v] of Object.entries(where)) {
        const rv = (r as unknown as Record<string, unknown>)[k];
        if (v && typeof v === 'object' && '$in' in (v as object)) {
          if (!((v as { $in: string[] }).$in.includes(rv as string))) return false;
        } else if (rv !== v) return false;
      }
      return true;
    });
  }
  async findOne(_entity: unknown, where: { moduleId: string }): Promise<FakeRow | null> {
    return this.rows.find((r) => r.moduleId === where.moduleId) ?? null;
  }
  async flush(): Promise<void> {
    this.ops.push({ kind: 'flush', payload: null });
  }
  async persistAndFlush(payload: FakeRow): Promise<void> {
    this.rows.push(payload);
    this.ops.push({ kind: 'persistAndFlush', payload });
  }
  remove(payload: FakeRow): void {
    this.rows = this.rows.filter((r) => r !== payload);
  }
  async removeAndFlush(payload: FakeRow): Promise<void> {
    this.remove(payload);
    this.ops.push({ kind: 'removeAndFlush', payload });
  }
  create(_entity: unknown, payload: FakeRow): FakeRow {
    return payload;
  }
}

class FakeMigrator {
  pending: Array<{ name: string }> = [];
  applied: string[] = [];
  reverted: string[] = [];
  shouldFailOnDown = false;
  async getPendingMigrations(): Promise<Array<{ name: string }>> {
    return this.pending;
  }
  async up(): Promise<Array<{ name: string }>> {
    const result = [...this.pending];
    this.applied.push(...result.map((m) => m.name));
    this.pending = [];
    return result;
  }
  async down(opts: { migrations: string[] }): Promise<Array<{ name: string }>> {
    if (this.shouldFailOnDown) throw new Error('migrator-down-failed');
    this.reverted.push(...opts.migrations);
    return opts.migrations.map((name) => ({ name }));
  }
}

class FakeRedis {
  store = new Map<string, string>();
  channels: Array<{ channel: string; message: string }> = [];
  async set(key: string, value: string): Promise<'OK' | null> {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async eval(script: string, _n: number, key: string, expectedValue: string): Promise<number> {
    if (script.includes('del')) {
      if (this.store.get(key) === expectedValue) {
        this.store.delete(key);
        return 1;
      }
      return 0;
    }
    return 0;
  }
  async publish(channel: string, message: string): Promise<number> {
    this.channels.push({ channel, message });
    return 0;
  }
}

class FakeAuditLog {
  records: Array<Record<string, unknown>> = [];
  async record(entry: Record<string, unknown>): Promise<void> {
    this.records.push(entry);
  }
}

/** What the orchestrator hands an uninstall hook; `hard` is the discriminator. */
type FakeUninstallHook = (ctx: { hard: boolean }) => Promise<void>;

function buildRegistry(
  entries: Array<{
    id: string;
    deps?: string[];
    installHook?: () => Promise<void>;
    uninstallHook?: FakeUninstallHook;
    activation?: ModuleActivation;
  }>,
): LoadedManifestRegistry {
  const map = new Map<
    string,
    {
      manifest: ReturnType<typeof defineModuleManifest>;
      filePath: string;
      installHook?: () => Promise<void>;
      uninstallHook?: FakeUninstallHook;
    }
  >();
  for (const e of entries) {
    map.set(e.id, {
      manifest: defineModuleManifest({
        id: e.id,
        name: e.id,
        version: '1.0.0',
        dependencies: e.deps ?? [],
        ...(e.activation ? { activation: e.activation } : {}),
      }),
      filePath: `<test:${e.id}>`,
      ...(e.installHook ? { installHook: e.installHook } : {}),
      ...(e.uninstallHook ? { uninstallHook: e.uninstallHook } : {}),
    });
  }
  const graph = new ModuleDepGraph([...map.values()].map((e) => e.manifest));
  // `participants: []` is the deliberate answer, not an omission: this
  // fixture registry enumerates its modules and none of them keeps a
  // projection of the manifest set (feature 080, T036a / D-159). A
  // registry that could not answer would say `null`, and the orchestrator
  // refuses an install over that rather than reconciling nothing quietly.
  return { modules: map as never, graph, participants: [] };
}

function buildOrchestrator(opts: {
  registry: LoadedManifestRegistry;
  em?: FakeEm;
  migrator?: FakeMigrator;
  redis?: FakeRedis;
  auditLog?: FakeAuditLog;
  migrationOwnership?: MigrationOwnership;
}) {
  const em = opts.em ?? new FakeEm();
  const migrator = opts.migrator ?? new FakeMigrator();
  const redis = opts.redis ?? new FakeRedis();
  const auditLog = opts.auditLog ?? new FakeAuditLog();
  // The orchestrator obtains its migrator through the injectable
  // `migratorFor` seam (feature 065) so the real accessor — which runs the
  // legacy-name pre-flight against a database — is never reached in a unit test.
  const orm = {} as never;
  return {
    em,
    migrator,
    redis,
    auditLog,
    orchestrator: new ModuleLifecycleOrchestrator({
      orm,
      redis: redis as never,
      em: () => em as never,
      auditLog: auditLog as never,
      registry: opts.registry,
      // Feature 080 (T033): the orchestrator's hard uninstall distinguishes
      // "this module owns no migration" from "the registry I was handed cannot
      // answer for this module", and refuses the second. These fixtures are
      // fictional modules that the committed core registry has never heard of,
      // so a test declares its own ownership — every module its registry holds
      // is covered, and none of them owns a migration. Saying so is what makes
      // the `[]` the assertions below expect a *statement* rather than the
      // silence the fail-open used to produce.
      migrationOwnership:
        opts.migrationOwnership ?? migrationOwnershipOf([], opts.registry.modules.keys()),
      migratorFor: async () => migrator as never,
    }),
  };
}

describe('ModuleLifecycleOrchestrator (unit)', () => {
  describe('install — happy path', () => {
    it('inserts an installed-state row and audits module.installed', async () => {
      const reg = buildRegistry([{ id: 'demo' }]);
      const { orchestrator, em, auditLog } = buildOrchestrator({ registry: reg });

      const result = await orchestrator.install('demo');

      expect(result.state).toBe('installed');
      expect(em.rows).toHaveLength(1);
      expect(em.rows[0]?.state).toBe('installed');
      expect(em.rows[0]?.version).toBe('1.0.0');
      expect(auditLog.records.some((r) => r['action'] === 'module.installed')).toBe(true);
    });

    it('refuses to install when a declared dep has no installed row', async () => {
      const reg = buildRegistry([{ id: 'pricing' }, { id: 'quotes', deps: ['pricing'] }]);
      const { orchestrator, auditLog } = buildOrchestrator({ registry: reg });

      await expect(orchestrator.install('quotes')).rejects.toBeInstanceOf(LifecycleError);
      try {
        await orchestrator.install('quotes');
      } catch (err) {
        expect((err as LifecycleError).kind).toBe('missing-deps');
        expect((err as LifecycleError).details['missing']).toEqual(['pricing']);
      }
      expect(
        auditLog.records.some((r) => r['action'] === 'module.dependency_blocked'),
      ).toBe(true);
    });

    it('returns "already-installed" without re-running migrations', async () => {
      const reg = buildRegistry([{ id: 'demo' }]);
      const { orchestrator, migrator } = buildOrchestrator({
        registry: reg,
        em: new FakeEm([
          {
            moduleId: 'demo',
            state: 'installed',
            version: '1.0.0',
            installedAt: new Date(),
            lastStateChangeAt: new Date(),
            lastInstallFailedAt: null,
            lastInstallError: null,
          },
        ]),
      });

      migrator.pending = [{ name: 'should-not-run' }];
      const result = await orchestrator.install('demo');

      expect(result.state).toBe('already-installed');
      expect(migrator.applied).toHaveLength(0);
    });
  });

  describe('install — SC-002: failed installs leave pre-install state', () => {
    it('reverts migrations and avoids the installed-state row when the install hook throws', async () => {
      let hookCalled = 0;
      const reg = buildRegistry([
        {
          id: 'failing_module',
          installHook: async () => {
            hookCalled++;
            throw new Error('forced hook failure');
          },
        },
      ]);
      const migrator = new FakeMigrator();
      migrator.pending = [
        { name: '040_failing_module_init' },
        { name: '041_failing_module_grow' },
      ];
      const { orchestrator, em, auditLog, migrator: m } = buildOrchestrator({
        registry: reg,
        migrator,
      });

      await expect(orchestrator.install('failing_module')).rejects.toBeInstanceOf(LifecycleError);

      expect(hookCalled).toBe(1);
      expect(m.applied).toHaveLength(2);
      expect(m.reverted).toEqual(
        ['041_failing_module_grow', '040_failing_module_init'],
      );
      // Registry must NOT show installed; it ends up in 'uninstalled' with
      // the failure metadata set so a re-install is allowed.
      const row = em.rows.find((r) => r.moduleId === 'failing_module');
      expect(row?.state).toBe('uninstalled');
      expect(row?.lastInstallError).toMatch(/forced hook failure/);
      expect(
        auditLog.records.some((r) => r['action'] === 'module.install_failed'),
      ).toBe(true);
      expect(
        auditLog.records.some((r) => r['action'] === 'module.installed'),
      ).toBe(false);
    });
  });

  describe('uninstall — soft + hard', () => {
    it('soft uninstall keeps the row at state=uninstalled (data preserved)', async () => {
      const reg = buildRegistry([{ id: 'demo' }]);
      const seedRow: FakeRow = {
        moduleId: 'demo',
        state: 'installed',
        version: '1.0.0',
        installedAt: new Date(),
        lastStateChangeAt: new Date(),
        lastInstallFailedAt: null,
        lastInstallError: null,
      };
      const { orchestrator, em } = buildOrchestrator({
        registry: reg,
        em: new FakeEm([seedRow]),
      });

      const result = await orchestrator.uninstall('demo', { hard: false });
      expect(result.state).toBe('uninstalled');
      expect(result.hard).toBe(false);
      // Row preserved (soft).
      expect(em.rows.find((r) => r.moduleId === 'demo')?.state).toBe('uninstalled');
    });

    it('refuses uninstall when a dependent is still installed', async () => {
      const reg = buildRegistry([
        { id: 'pricing' },
        { id: 'quotes', deps: ['pricing'] },
      ]);
      const seed: FakeRow[] = [
        {
          moduleId: 'pricing',
          state: 'installed',
          version: '1.0.0',
          installedAt: new Date(),
          lastStateChangeAt: new Date(),
          lastInstallFailedAt: null,
          lastInstallError: null,
        },
        {
          moduleId: 'quotes',
          state: 'installed',
          version: '1.0.0',
          installedAt: new Date(),
          lastStateChangeAt: new Date(),
          lastInstallFailedAt: null,
          lastInstallError: null,
        },
      ];
      const { orchestrator } = buildOrchestrator({
        registry: reg,
        em: new FakeEm(seed),
      });

      try {
        await orchestrator.uninstall('pricing', { hard: false });
        throw new Error('should have rejected');
      } catch (err) {
        expect(err).toBeInstanceOf(LifecycleError);
        expect((err as LifecycleError).kind).toBe('dependents-block');
        expect((err as LifecycleError).details['dependents']).toEqual(['quotes']);
      }
    });
  });

  /**
   * The `manifest.ts` install seam — the **only** one, since feature 072's D-46
   * deleted the container-side `ctx.onInstall` / `ctx.onUninstall` that nothing
   * ran. Its semantics existed only in the orchestrator's implementation, and
   * are documented in `docs/docs/architecture/kernel.md`; these tests are what
   * that documentation stands on.
   *
   * The install-abort half is covered above by SC-002.
   */
  describe('manifest install/uninstall hooks — the documented contract', () => {
    function installedRow(moduleId: string): FakeRow {
      return {
        moduleId,
        state: 'installed',
        version: '1.0.0',
        installedAt: new Date(),
        lastStateChangeAt: new Date(),
        lastInstallFailedAt: null,
        lastInstallError: null,
      };
    }

    it('aborts the uninstall and removes nothing when the uninstall hook throws', async () => {
      const reg = buildRegistry([
        {
          id: 'demo',
          uninstallHook: async () => {
            throw new Error('forced uninstall failure');
          },
        },
      ]);
      const { orchestrator, em, auditLog, migrator } = buildOrchestrator({
        registry: reg,
        em: new FakeEm([installedRow('demo')]),
      });

      await expect(orchestrator.uninstall('demo', { hard: true })).rejects.toMatchObject({
        kind: 'uninstall-failed',
      });

      // The hook runs before every removal, so a throw leaves the row, the
      // settings and the schema exactly as they were.
      expect(em.rows.find((r) => r.moduleId === 'demo')?.state).toBe('installed');
      expect(em.ops).toHaveLength(0);
      expect(migrator.reverted).toEqual([]);
      expect(auditLog.records.some((r) => r['action'] === 'module.uninstalled')).toBe(false);
    });

    it('hands the hook `hard`, so soft and destructive uninstall are distinguishable', async () => {
      const seen: boolean[] = [];
      const reg = buildRegistry([
        {
          id: 'demo',
          uninstallHook: async (ctx) => {
            seen.push(ctx.hard);
          },
        },
      ]);
      const { orchestrator, em } = buildOrchestrator({
        registry: reg,
        em: new FakeEm([installedRow('demo')]),
      });

      await orchestrator.uninstall('demo', { hard: false });
      // Soft leaves the row behind, so re-seed to reach the hard path.
      em.rows = [installedRow('demo')];
      await orchestrator.uninstall('demo', { hard: true });

      expect(seen).toEqual([false, true]);
    });

    /**
     * Feature 080, T033 — the fail-open `revertMigrationsFor` had, and the two
     * branches that replace it.
     *
     * It used to warn and return `[]` for *any* empty filter, so a module whose
     * migrations the orchestrator could not see hard-uninstalled to a warning
     * and left its tables in the database. That is data left behind by an
     * operation the operator believes removed it — and the population it
     * happens to is exactly the one the mechanism exists for, an installed
     * extension package whose chain is discovered at runtime (D-155.3(c)).
     */
    describe('the migration revert distinguishes "owns none" from "cannot answer"', () => {
      it('is silent and proceeds when the registry covers the module and it owns none', async () => {
        const reg = buildRegistry([{ id: 'demo' }]);
        const { orchestrator, em, migrator } = buildOrchestrator({
          registry: reg,
          em: new FakeEm([installedRow('demo')]),
          // Covered, owns nothing. The ordinary case: 39 core modules are in it.
          migrationOwnership: migrationOwnershipOf([], ['demo']),
        });

        const result = await orchestrator.uninstall('demo', { hard: true });

        expect(result.revertedMigrations).toEqual([]);
        expect(migrator.reverted).toEqual([]);
        // It really did uninstall: the row is gone, which is what makes this
        // branch different from the refusal below rather than a softer spelling
        // of it.
        expect(em.rows).toHaveLength(0);
      });

      it('refuses, and removes nothing, when the registry cannot answer for the module', async () => {
        const reg = buildRegistry([{ id: 'loyalty' }]);
        const { orchestrator, em, migrator } = buildOrchestrator({
          registry: reg,
          em: new FakeEm([installedRow('loyalty')]),
          // The shape a package creates: the manifest registry knows the
          // module — the operator installed it, it composes, it has routes —
          // while the migration registry handed to this orchestrator is core's
          // and has never heard of it.
          migrationOwnership: migrationOwnershipOf([], ['core', 'orders']),
        });

        await expect(orchestrator.uninstall('loyalty', { hard: true })).rejects.toThrow(
          /cannot enumerate the module's chain/,
        );
        expect(migrator.reverted).toEqual([]);
        // The registration survives. A hard uninstall that reverted nothing and
        // dropped the row would leave the module's tables with no owner and no
        // way back — the outcome this refusal exists to prevent.
        expect(em.rows).toHaveLength(1);
      });

      it('reverts a covered module\'s chain newest first', async () => {
        const reg = buildRegistry([{ id: 'loyalty' }]);
        const { orchestrator, migrator } = buildOrchestrator({
          registry: reg,
          em: new FakeEm([installedRow('loyalty')]),
          migrationOwnership: migrationOwnershipOf(
            [
              {
                moduleId: 'loyalty',
                cls: { name: 'Migration20260801T000000LoyaltyOne' } as never,
                origin: 'external',
              },
              {
                moduleId: 'loyalty',
                cls: { name: 'Migration20260901T000000LoyaltyTwo' } as never,
                origin: 'external',
              },
            ],
            ['loyalty'],
          ),
        });

        const result = await orchestrator.uninstall('loyalty', { hard: true });

        expect(migrator.reverted).toEqual([
          'Migration20260901T000000LoyaltyTwo',
          'Migration20260801T000000LoyaltyOne',
        ]);
        expect(result.revertedMigrations).toEqual(migrator.reverted);
      });
    });

    it('fires neither hook on disable or enable — that is the other axis', async () => {
      let installs = 0;
      let uninstalls = 0;
      const reg = buildRegistry([
        {
          id: 'demo',
          installHook: async () => {
            installs++;
          },
          uninstallHook: async () => {
            uninstalls++;
          },
        },
      ]);
      const { orchestrator } = buildOrchestrator({
        registry: reg,
        em: new FakeEm([installedRow('demo')]),
      });

      await orchestrator.disable('demo');
      await orchestrator.enable('demo');

      expect(installs).toBe(0);
      expect(uninstalls).toBe(0);
    });

    it('re-runs the install hook after a failed install and after a soft uninstall', async () => {
      let installs = 0;
      let failNext = true;
      const reg = buildRegistry([
        {
          id: 'demo',
          installHook: async () => {
            installs++;
            if (failNext) throw new Error('forced hook failure');
          },
        },
      ]);
      const { orchestrator } = buildOrchestrator({ registry: reg });

      await expect(orchestrator.install('demo')).rejects.toBeInstanceOf(LifecycleError);
      expect(installs).toBe(1);

      // A failed install parks the row at 'uninstalled', so the retry runs the
      // hook a second time — the hook is idempotent by contract, not by luck.
      failNext = false;
      await orchestrator.install('demo');
      expect(installs).toBe(2);

      // And so does a soft-uninstall → install cycle.
      await orchestrator.uninstall('demo', { hard: false });
      await orchestrator.install('demo');
      expect(installs).toBe(3);
    });
  });

  describe('enable/disable', () => {
    it('disable refuses without --cascade when a dependent is enabled', async () => {
      const reg = buildRegistry([
        { id: 'pricing' },
        { id: 'quotes', deps: ['pricing'] },
      ]);
      const seed: FakeRow[] = [
        {
          moduleId: 'pricing',
          state: 'installed',
          version: '1.0.0',
          installedAt: new Date(),
          lastStateChangeAt: new Date(),
          lastInstallFailedAt: null,
          lastInstallError: null,
        },
        {
          moduleId: 'quotes',
          state: 'installed',
          version: '1.0.0',
          installedAt: new Date(),
          lastStateChangeAt: new Date(),
          lastInstallFailedAt: null,
          lastInstallError: null,
        },
      ];
      const { orchestrator } = buildOrchestrator({
        registry: reg,
        em: new FakeEm(seed),
      });

      await expect(
        orchestrator.disable('pricing', { cascade: false }),
      ).rejects.toBeInstanceOf(LifecycleError);
    });

    it('disable --cascade walks reverse-topological order', async () => {
      const reg = buildRegistry([
        { id: 'pricing' },
        { id: 'quotes', deps: ['pricing'] },
      ]);
      const seed: FakeRow[] = [
        {
          moduleId: 'pricing',
          state: 'installed',
          version: '1.0.0',
          installedAt: new Date(),
          lastStateChangeAt: new Date(),
          lastInstallFailedAt: null,
          lastInstallError: null,
        },
        {
          moduleId: 'quotes',
          state: 'installed',
          version: '1.0.0',
          installedAt: new Date(),
          lastStateChangeAt: new Date(),
          lastInstallFailedAt: null,
          lastInstallError: null,
        },
      ];
      const { orchestrator, auditLog } = buildOrchestrator({
        registry: reg,
        em: new FakeEm(seed),
      });

      const result = await orchestrator.disable('pricing', { cascade: true });
      expect(result.state).toBe('disabled');
      expect(result.cascaded).toEqual(['quotes']);
      // Two disabled audit-log entries: one for quotes, one for pricing.
      const disabledEntries = auditLog.records.filter(
        (r) => r['action'] === 'module.disabled',
      );
      expect(disabledEntries.length).toBe(2);
    });
  });

  /**
   * D-36a item 3 / issue #37 — the platform axis honours `nonDeactivatable`.
   *
   * Until this landed, nothing anywhere on the platform axis read the field:
   * `module:disable auth` proceeded, and the declaration was a comment that
   * looked like a guard. A declaration nothing checks reads as done and is
   * worse than no declaration at all.
   *
   * The refusal is unconditional — there is deliberately no `--force`. The
   * consequence of disabling one of these modules is a deployment that cannot
   * authenticate the operator who would undo it, which is not a trade-off
   * anyone can weigh at the prompt. `--force` guards *data loss* on
   * `uninstall --hard`, where the operator can.
   *
   * D-69 (issue #145) extended the same declaration to `uninstall`, soft and
   * hard alike — see the nested describe below.
   */
  describe('nonDeactivatable is enforced on the platform axis', () => {
    const LOCKED: ModuleActivation = {
      nonDeactivatable: true,
      reason: 'Nobody could sign in to switch it back on.',
    };

    function seedInstalled(...ids: string[]): FakeRow[] {
      return ids.map((moduleId) => ({
        moduleId,
        state: 'installed',
        version: '1.0.0',
        installedAt: new Date(),
        lastStateChangeAt: new Date(),
        lastInstallFailedAt: null,
        lastInstallError: null,
      }));
    }

    it('refuses, echoes the declared reason, and leaves the registry row alone', async () => {
      const reg = buildRegistry([{ id: 'auth', activation: LOCKED }]);
      const { orchestrator, em, auditLog } = buildOrchestrator({
        registry: reg,
        em: new FakeEm(seedInstalled('auth')),
      });

      await expect(orchestrator.disable('auth')).rejects.toMatchObject({
        kind: 'non-deactivatable',
      });
      try {
        await orchestrator.disable('auth');
      } catch (err) {
        // The operator reads the module's own sentence, not a generic refusal:
        // the reason is the only thing that tells them why.
        expect((err as LifecycleError).message).toContain(LOCKED.reason);
      }

      expect(em.rows[0]?.state).toBe('installed');
      expect(auditLog.records.some((r) => r['action'] === 'module.disabled')).toBe(false);
    });

    it('refuses a cascade that would take a non-deactivatable dependent down', async () => {
      // The dangerous shape: the target itself is ordinary, and the module the
      // platform cannot run without is only reached through the cascade.
      const reg = buildRegistry([
        { id: 'organizations' },
        { id: 'auth', deps: ['organizations'], activation: LOCKED },
      ]);
      const { orchestrator, em, auditLog } = buildOrchestrator({
        registry: reg,
        em: new FakeEm(seedInstalled('organizations', 'auth')),
      });

      await expect(
        orchestrator.disable('organizations', { cascade: true }),
      ).rejects.toMatchObject({ kind: 'non-deactivatable' });

      // Refused before any write — a partially-applied cascade is the one
      // outcome worse than the refusal.
      expect(em.rows.every((r) => r.state === 'installed')).toBe(true);
      expect(auditLog.records.some((r) => r['action'] === 'module.disabled')).toBe(false);
    });

    /**
     * SC-009, the platform half — every module in the core set, on the shipped
     * manifests rather than a fixture.
     *
     * `assertDeactivatable` binds **both** axes, which is what makes this a
     * release-note item rather than bookkeeping: declaring ten more modules
     * core also takes `module:disable catalog` and `module:disable orders` away
     * from a deployment operator, with no `--force`. Asserting it here is how
     * that consequence stays visible — the fixture cases above prove the
     * mechanism, and these prove the shipped declarations reach it. It began as
     * issue #88's pair (`currencies`, `transactional_emails`) and feature 074
     * widened it to the whole set, because a lock nobody exercises is a lock
     * that can be dropped from a manifest without a test going red.
     */
    it.each(
      REGISTERED_MANIFESTS.filter(
        (e) =>
          e.manifest.activation !== undefined && 'nonDeactivatable' in e.manifest.activation,
      ).map((e) => e.manifest.id),
    )(
      'refuses `module:disable %s` on the shipped manifest',
      async (moduleId) => {
        const entries = REGISTERED_MANIFESTS.map((e) => ({
          manifest: e.manifest,
          filePath: e.filePath,
        }));
        const registry: LoadedManifestRegistry = {
          modules: new Map(entries.map((e) => [e.manifest.id, e])) as never,
          graph: new ModuleDepGraph(entries.map((e) => e.manifest)),
          participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
        };
        const { orchestrator, em } = buildOrchestrator({
          registry,
          em: new FakeEm(seedInstalled(moduleId)),
        });

        await expect(orchestrator.disable(moduleId)).rejects.toMatchObject({
          kind: 'non-deactivatable',
        });
        expect(em.rows[0]?.state).toBe('installed');
      },
    );

    /**
     * D-69 (issue #145) — the declaration binds `uninstall` as well.
     *
     * `uninstall` is `disable` **plus** the settings sweep and, on `--hard`, the
     * migration revert: every consequence the lock refuses, and two more. So the
     * refusal is the same one, on both paths, with no `--force`.
     *
     * The asymmetry the repository defends elsewhere in this file — a pause
     * preserves the operator's activation choice, a soft uninstall resets it to
     * the manifest default — is a statement about that *choice*, and a
     * `nonDeactivatable` module declares no activation control at all. Those two
     * cases exercise `blog`, which has one, and keep passing unchanged.
     */
    describe('uninstall — the same declaration binds it, soft and hard alike', () => {
      /** The activation-adjacent settings row, as the sweep sees it. */
      const ownedSetting = (moduleId: string): FakeRow =>
        ({ moduleId: `${moduleId}.some_setting`, ownerModule: moduleId } as unknown as FakeRow);

      it('refuses a soft uninstall, echoing the declared reason, and sweeps nothing', async () => {
        const reg = buildRegistry([{ id: 'auth', activation: LOCKED }]);
        const em = new FakeEm([...seedInstalled('auth'), ownedSetting('auth')]);
        const { orchestrator, auditLog } = buildOrchestrator({ registry: reg, em });

        await expect(orchestrator.uninstall('auth', { hard: false })).rejects.toMatchObject({
          kind: 'non-deactivatable',
        });
        try {
          await orchestrator.uninstall('auth', { hard: false });
        } catch (err) {
          expect((err as LifecycleError).message).toContain(LOCKED.reason);
        }

        // Soft is the path that deletes every Setting the module owns — the one
        // thing `disable` is guaranteed never to do. Nothing moved.
        expect(em.rows.find((r) => r.moduleId === 'auth')?.state).toBe('installed');
        expect(
          em.rows.some((r) => (r as unknown as Record<string, unknown>)['ownerModule'] === 'auth'),
          'a refused uninstall must not sweep the module-owned settings',
        ).toBe(true);
        expect(auditLog.records.some((r) => r['action'] === 'module.uninstalled')).toBe(false);
      });

      it('refuses a hard uninstall too, reverting no migration and deleting no row', async () => {
        const reg = buildRegistry([{ id: 'auth', activation: LOCKED }]);
        const em = new FakeEm(seedInstalled('auth'));
        const { orchestrator, migrator, auditLog } = buildOrchestrator({ registry: reg, em });

        await expect(orchestrator.uninstall('auth', { hard: true })).rejects.toMatchObject({
          kind: 'non-deactivatable',
        });

        expect(migrator.reverted).toEqual([]);
        expect(em.rows.find((r) => r.moduleId === 'auth')?.state).toBe('installed');
        expect(auditLog.records.some((r) => r['action'] === 'module.uninstalled')).toBe(false);
      });

      it('refuses before the dependents check and before the uninstall hook', async () => {
        // The dependents block covers the shipped set by accident today — every
        // locked module happens to have an installed dependent. A locked module
        // with none must still be refused, and refused before anything runs.
        let hookCalls = 0;
        const reg = buildRegistry([
          {
            id: 'auth',
            activation: LOCKED,
            uninstallHook: async () => {
              hookCalls++;
            },
          },
        ]);
        const { orchestrator } = buildOrchestrator({
          registry: reg,
          em: new FakeEm(seedInstalled('auth')),
        });

        await expect(orchestrator.uninstall('auth', { hard: false })).rejects.toMatchObject({
          kind: 'non-deactivatable',
        });
        expect(hookCalls).toBe(0);
      });

      it.each(
        REGISTERED_MANIFESTS.filter(
          (e) =>
            e.manifest.activation !== undefined && 'nonDeactivatable' in e.manifest.activation,
        ).map((e) => e.manifest.id),
      )('refuses `module:uninstall %s` on the shipped manifest', async (moduleId) => {
        const entries = REGISTERED_MANIFESTS.map((e) => ({
          manifest: e.manifest,
          filePath: e.filePath,
        }));
        const registry: LoadedManifestRegistry = {
          modules: new Map(entries.map((e) => [e.manifest.id, e])) as never,
          graph: new ModuleDepGraph(entries.map((e) => e.manifest)),
          participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
        };
        const { orchestrator, em } = buildOrchestrator({
          registry,
          em: new FakeEm(seedInstalled(moduleId)),
        });

        await expect(orchestrator.uninstall(moduleId, { hard: false })).rejects.toMatchObject({
          kind: 'non-deactivatable',
        });
        expect(em.rows[0]?.state).toBe('installed');
      });

      it('leaves an orphan registry row uninstallable — the one job uninstall exists for', async () => {
        // The guard reads the manifest, and an orphan has none, so it is inert
        // here. That is by design and previously undefended: a refactor that
        // resolved the declaration from the registry row instead of the manifest
        // would take the only cleanup path away, and nothing would have said so.
        const reg = buildRegistry([{ id: 'auth', activation: LOCKED }]);
        const em = new FakeEm(seedInstalled('old_module'));
        const { orchestrator } = buildOrchestrator({ registry: reg, em });

        const result = await orchestrator.uninstall('old_module', { hard: false });

        expect(result.state).toBe('uninstalled');
        expect(em.rows.find((r) => r.moduleId === 'old_module')?.state).toBe('uninstalled');
      });

      it('keeps `already-uninstalled` a success no-op for a locked module', async () => {
        // Refusing here would break idempotent tooling for nothing: there is no
        // registration left to protect.
        const reg = buildRegistry([{ id: 'auth', activation: LOCKED }]);
        const row = seedInstalled('auth')[0]!;
        row.state = 'uninstalled';
        const { orchestrator } = buildOrchestrator({ registry: reg, em: new FakeEm([row]) });

        const result = await orchestrator.uninstall('auth', { hard: false });
        expect(result.state).toBe('already-uninstalled');
      });
    });

    it('leaves an ordinary module with an activation control disable-able', async () => {
      // The two axes stay independent: declaring an operator control says
      // nothing about whether the deployment may withdraw the module.
      const reg = buildRegistry([
        { id: 'blog', activation: { settingCode: 'blog.enabled', default: true } },
      ]);
      const { orchestrator } = buildOrchestrator({
        registry: reg,
        em: new FakeEm(seedInstalled('blog')),
      });

      const result = await orchestrator.disable('blog');
      expect(result.state).toBe('disabled');
    });
  });

  describe('status', () => {
    it('lists every manifest with registry state when present, "not-installed" otherwise', async () => {
      const reg = buildRegistry([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      const seed: FakeRow[] = [
        {
          moduleId: 'a',
          state: 'installed',
          version: '1.0.0',
          installedAt: new Date(),
          lastStateChangeAt: new Date(),
          lastInstallFailedAt: null,
          lastInstallError: null,
        },
        {
          moduleId: 'b',
          state: 'disabled',
          version: '1.0.0',
          installedAt: new Date(),
          lastStateChangeAt: new Date(),
          lastInstallFailedAt: null,
          lastInstallError: null,
        },
      ];
      const { orchestrator } = buildOrchestrator({
        registry: reg,
        em: new FakeEm(seed),
      });

      const rows = await orchestrator.status();
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get('a')?.state).toBe('installed');
      expect(byId.get('b')?.state).toBe('disabled');
      expect(byId.get('c')?.state).toBe('not-installed');
    });

    it('flags a module as orphan when registry references no manifest on disk', async () => {
      const reg = buildRegistry([{ id: 'a' }]);
      const seed: FakeRow[] = [
        {
          moduleId: 'old_module',
          state: 'installed',
          version: '1.0.0',
          installedAt: new Date(),
          lastStateChangeAt: new Date(),
          lastInstallFailedAt: null,
          lastInstallError: null,
        },
      ];
      const { orchestrator } = buildOrchestrator({
        registry: reg,
        em: new FakeEm(seed),
      });

      const rows = await orchestrator.status();
      const orphan = rows.find((r) => r.id === 'old_module');
      expect(orphan?.flags).toContain('orphan');
    });
  });

  /**
   * The two axes differ on what they do to the operator's activation choice, and
   * nothing in the tree said so until the product owner ruled on it (2026-08-15).
   *
   * `disable` → `enable` is a **pause**: the platform row flips, the settings are
   * untouched, and the operator's choice comes back. Soft `uninstall` → `install`
   * is **taking the module off the table**: the settings sweep at
   * `orchestrator.ts:454-461` runs on soft and hard alike, and the activation
   * control is a Setting the module owns, so a re-install starts from the
   * manifest default.
   *
   * That asymmetry is deliberate, not an oversight — but it is surprising enough
   * that someone would "fix" it. These two assertions are what makes the fix
   * fail.
   */
  describe('what each axis does to the operator activation choice', () => {
    /** The activation Setting, as the sweep sees it: a row owned by the module. */
    const activationSetting = (moduleId: string): FakeRow =>
      ({ moduleId: `${moduleId}.enabled`, ownerModule: moduleId } as unknown as FakeRow);

    const installedRow = (moduleId: string): FakeRow => ({
      moduleId,
      state: 'installed',
      version: '1.0.0',
      installedAt: new Date(),
      lastStateChangeAt: new Date(),
      lastInstallFailedAt: null,
      lastInstallError: null,
    });

    it('disable then enable preserves it — a pause drops no setting', async () => {
      const reg = buildRegistry([
        { id: 'blog', activation: { settingCode: 'blog.enabled', default: true } },
      ]);
      const em = new FakeEm([installedRow('blog'), activationSetting('blog')]);
      const { orchestrator } = buildOrchestrator({ registry: reg, em });

      await orchestrator.disable('blog', { cascade: false });
      await orchestrator.enable('blog');

      expect(
        em.rows.some((r) => (r as unknown as Record<string, unknown>)['ownerModule'] === 'blog'),
        'the activation setting must survive a disable/enable cycle',
      ).toBe(true);
    });

    it('a soft uninstall drops it, so a re-install starts from the manifest default', async () => {
      const reg = buildRegistry([
        { id: 'blog', activation: { settingCode: 'blog.enabled', default: true } },
      ]);
      const em = new FakeEm([installedRow('blog'), activationSetting('blog')]);
      const { orchestrator } = buildOrchestrator({ registry: reg, em });

      await orchestrator.uninstall('blog', { hard: false });

      expect(
        em.rows.some((r) => (r as unknown as Record<string, unknown>)['ownerModule'] === 'blog'),
        'a soft uninstall sweeps the module-owned settings, the activation one included',
      ).toBe(false);
      // And the registration row is preserved — that is what makes it *soft*.
      expect(em.rows.find((r) => r.moduleId === 'blog')?.state).toBe('uninstalled');
    });
  });
});
