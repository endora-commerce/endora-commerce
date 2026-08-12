import { describe, it, expect } from 'vitest';
import { defineModuleManifest, type ModuleActivation } from '@b2b/contracts';
import { ModuleLifecycleOrchestrator, LifecycleError } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';

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

function buildRegistry(
  entries: Array<{
    id: string;
    deps?: string[];
    installHook?: () => Promise<void>;
    activation?: ModuleActivation;
  }>,
): LoadedManifestRegistry {
  const map = new Map<string, { manifest: ReturnType<typeof defineModuleManifest>; filePath: string; installHook?: () => Promise<void> }>();
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
    });
  }
  const graph = new ModuleDepGraph([...map.values()].map((e) => e.manifest));
  return { modules: map as never, graph };
}

function buildOrchestrator(opts: {
  registry: LoadedManifestRegistry;
  em?: FakeEm;
  migrator?: FakeMigrator;
  redis?: FakeRedis;
  auditLog?: FakeAuditLog;
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
   */
  describe('disable — nonDeactivatable is enforced on the platform axis', () => {
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
});
