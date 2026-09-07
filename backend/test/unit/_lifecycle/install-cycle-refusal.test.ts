import { describe, it, expect } from 'vitest';
import { defineModuleManifest } from '@endora-commerce/contracts';
import {
  ModuleLifecycleOrchestrator,
  LifecycleError,
} from '../../../src/lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/lifecycle/services/dep-graph.js';
import type { LoadedManifestRegistry } from '../../../src/lifecycle/services/manifest-loader.js';
import { BASELINE_MIGRATIONS } from '@endora-commerce/platform/migrations';
import { orderMigrations } from '../../../src/db/migration-order.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';

/**
 * The install-time reader of the `module-cycle` diagnostic — feature 081
 * FR-012, US4.
 *
 * A dependency cycle is not thrown by the ordering function (that would let one
 * stranger's manifest stop a shop's own schema from migrating), so it is
 * answered in three places instead. This file covers the third: the moment a
 * cycle would be *created* is the one moment where refusing costs nothing, so
 * the lifecycle refuses that install and names the members.
 *
 * Unit-level, against the same in-memory stubs `orchestrator.test.ts` uses: the
 * refusal is graph arithmetic over the loaded manifests and the installed set,
 * and reaches no database.
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

class FakeEm {
  rows: FakeRow[] = [];
  constructor(seed: FakeRow[] = []) {
    this.rows = [...seed];
  }
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
  create(_entity: unknown, payload: FakeRow): FakeRow {
    return payload;
  }
}

class FakeMigrator {
  pending: Array<{ name: string }> = [];
  applied: string[] = [];
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
    return opts.migrations.map((name) => ({ name }));
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
  records: Array<Record<string, unknown>> = [];
  async record(entry: Record<string, unknown>): Promise<void> {
    this.records.push(entry);
  }
}

function buildRegistry(
  entries: Array<{ id: string; deps?: string[] }>,
): LoadedManifestRegistry {
  const map = new Map<string, { manifest: ReturnType<typeof defineModuleManifest>; filePath: string }>();
  for (const e of entries) {
    map.set(e.id, {
      manifest: defineModuleManifest({
        id: e.id,
        name: e.id,
        version: '1.0.0',
        dependencies: e.deps ?? [],
      }),
      filePath: `<test:${e.id}>`,
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

function buildOrchestrator(opts: { registry: LoadedManifestRegistry; installed?: string[] }) {
  const em = new FakeEm((opts.installed ?? []).map(installedRow));
  const migrator = new FakeMigrator();
  const redis = new FakeRedis();
  const auditLog = new FakeAuditLog();
  return {
    em,
    migrator,
    auditLog,
    orchestrator: new ModuleLifecycleOrchestrator({
      orm: {} as never,
      redis: redis as never,
      em: () => em as never,
      auditLog: auditLog as never,
      registry: opts.registry,
      migratorFor: async () => migrator as never,
    }),
  };
}

async function refusalOf(promise: Promise<unknown>): Promise<LifecycleError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof LifecycleError) return err;
    throw err;
  }
  throw new Error('expected the install to be refused, but it succeeded');
}

describe('install refuses a module whose arrival closes a dependency cycle (FR-012)', () => {
  /**
   * The shape US4 is written against: two installed packages that declare each
   * other. `pkg_alpha` is installed first, declaring nothing the platform can
   * see; a later version of it declares `pkg_beta`, and `pkg_beta` declares
   * `pkg_alpha` back. Neither module's own install was wrong when it happened —
   * the loop only exists once the second one arrives, which is why the arrival
   * is where it is refused.
   */
  const MUTUAL = [
    { id: 'pkg_alpha', deps: ['pkg_beta'] },
    { id: 'pkg_beta', deps: ['pkg_alpha'] },
  ];

  it('refuses the install and names both members', async () => {
    const { orchestrator } = buildOrchestrator({
      registry: buildRegistry(MUTUAL),
      installed: ['pkg_alpha'],
    });

    const err = await refusalOf(orchestrator.install('pkg_beta'));

    expect(err.kind).toBe('manifest-cycle');
    expect(err.details['cycle']).toEqual(['pkg_alpha', 'pkg_beta']);
    expect(err.message).toContain('pkg_alpha');
    expect(err.message).toContain('pkg_beta');
    expect(err.message).toContain('dependencies');
  });

  it('allows the same install once the cycle is gone', async () => {
    // The red proof's other half: identical fixture but for the one edge that
    // closes the loop. Without it, a refusal that fired on every install would
    // look exactly as green.
    const { orchestrator, em } = buildOrchestrator({
      registry: buildRegistry([{ id: 'pkg_alpha', deps: [] }, { id: 'pkg_beta', deps: ['pkg_alpha'] }]),
      installed: ['pkg_alpha'],
    });

    const result = await orchestrator.install('pkg_beta');

    expect(result.state).toBe('installed');
    expect(em.rows.find((r) => r.moduleId === 'pkg_beta')?.state).toBe('installed');
  });

  it('leaves no registration row and applies no migration when it refuses', async () => {
    const { orchestrator, em, migrator } = buildOrchestrator({
      registry: buildRegistry(MUTUAL),
      installed: ['pkg_alpha'],
    });
    migrator.pending = [{ name: 'Migration20260901T090000PkgBetaInit' }];

    await refusalOf(orchestrator.install('pkg_beta'));

    expect(em.rows.map((r) => r.moduleId)).toEqual(['pkg_alpha']);
    expect(migrator.applied).toEqual([]);
  });

  it('audits the refusal as a blocked dependency', async () => {
    const { orchestrator, auditLog } = buildOrchestrator({
      registry: buildRegistry(MUTUAL),
      installed: ['pkg_alpha'],
    });

    await refusalOf(orchestrator.install('pkg_beta'));

    const blocked = auditLog.records.find((r) => r['action'] === 'module.dependency_blocked');
    expect(blocked).toBeDefined();
    expect((blocked?.['stateAfter'] as Record<string, unknown>)['cycle']).toEqual([
      'pkg_alpha',
      'pkg_beta',
    ]);
  });

  it('names every member of a cycle longer than two', async () => {
    const { orchestrator } = buildOrchestrator({
      registry: buildRegistry([
        { id: 'pkg_alpha', deps: ['pkg_gamma'] },
        { id: 'pkg_beta', deps: ['pkg_alpha'] },
        { id: 'pkg_gamma', deps: ['pkg_beta'] },
      ]),
      installed: ['pkg_alpha', 'pkg_beta'],
    });

    const err = await refusalOf(orchestrator.install('pkg_gamma'));

    expect(err.details['cycle']).toEqual(['pkg_alpha', 'pkg_beta', 'pkg_gamma']);
  });

  it('does not refuse an install that is merely downstream of a cycle', async () => {
    // The refusal is about the arrival, not about the state of the graph: a
    // loop between two other modules is somebody else's problem, and blocking
    // every subsequent install on it is exactly the platform-wide stall the
    // no-throw rule exists to prevent.
    const { orchestrator } = buildOrchestrator({
      registry: buildRegistry([
        { id: 'pkg_alpha', deps: ['pkg_beta'] },
        { id: 'pkg_beta', deps: ['pkg_alpha'] },
        { id: 'pkg_delta', deps: ['pkg_alpha'] },
      ]),
      installed: ['pkg_alpha', 'pkg_beta'],
    });

    const result = await orchestrator.install('pkg_delta');

    expect(result.state).toBe('installed');
  });

  it('refuses a module that declares itself into a cycle with nothing installed yet', async () => {
    // A cycle needs two members, so an install into an empty instance cannot
    // close one: `pkg_beta`'s dependency is simply missing, and the older, more
    // specific refusal is the one the operator should see.
    const { orchestrator } = buildOrchestrator({ registry: buildRegistry(MUTUAL) });

    const err = await refusalOf(orchestrator.install('pkg_beta'));

    expect(err.kind).toBe('missing-deps');
  });
});

describe('a cycle does not stop the platform migrating (US4)', () => {
  it('still emits every core migration when two packages declare each other', () => {
    const declared = new Map<string, readonly string[]>([
      ['core', []],
      ...DISCOVERED_MANIFESTS.map((e) => [e.id, e.manifest.dependencies ?? []] as const),
      ['pkg_alpha', ['pkg_beta']],
      ['pkg_beta', ['pkg_alpha']],
    ]);

    const clean = orderMigrations({
      entries: MIGRATION_REGISTRY,
      moduleDependencies: new Map<string, readonly string[]>([
        ['core', []],
        ...DISCOVERED_MANIFESTS.map((e) => [e.id, e.manifest.dependencies ?? []] as const),
      ]),
      baseline: BASELINE_MIGRATIONS,
    });
    const cycled = orderMigrations({
      entries: MIGRATION_REGISTRY,
      moduleDependencies: declared,
      baseline: BASELINE_MIGRATIONS,
    });

    expect(cycled.diagnostics.map((d) => d.modules)).toEqual([['pkg_alpha', 'pkg_beta']]);
    // The whole point of reporting rather than throwing: the platform's own
    // schema is emitted, in the same order, while the stranger's loop stands.
    expect(cycled.migrations.map((m) => m.name)).toEqual(clean.migrations.map((m) => m.name));
  });
});
