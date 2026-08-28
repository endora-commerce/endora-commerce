import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  LifecycleError,
  ModuleLifecycleOrchestrator,
} from '../../../src/lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/lifecycle/services/manifest-loader.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';

/**
 * FR-031 — the backfilled manifest dependency graph must stay installable.
 *
 * Feature 065 turns `dependencies` from a partially-declared set into an
 * honest one, which tightens the orchestrator's install gate
 * (`unresolvedDependenciesOf`). This test proves that from an empty
 * `module_registrations` table the whole registry installs in dependency
 * order without a single `missing-deps` failure.
 *
 * Install hooks are deliberately not wired: this asserts the *graph* is
 * satisfiable, which is what the backfill can break. The per-module hook
 * behaviour is covered by the existing lifecycle tests.
 */

describe('Module install — the whole registry installs from empty (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    // Rolled back in afterEach — the shared test database is untouched.
    await db.em().nativeDelete(ModuleRegistration, {});
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('installs every registered module in topological order with no missing dependency', async () => {
    const manifests = DISCOVERED_MANIFESTS.map((entry) => entry.manifest);
    const graph = new ModuleDepGraph(manifests);
    expect(graph.hasCycle()).toBeNull();

    const registry: LoadedManifestRegistry = {
      modules: new Map(
        DISCOVERED_MANIFESTS.map((entry) => [
          entry.id,
          { manifest: entry.manifest, filePath: '<manifest-index>' },
        ]),
      ) as never,
      graph,
      // Deliberately none (feature 080, T036a / D-159). The subject here is the
      // install *order* over the whole registered set, and the entries above
      // carry a placeholder `filePath`, so running `_i18n`'s participant would
      // have it look for bundle files under `dirname('<manifest-index>')`. The
      // participants are covered by `test/unit/_lifecycle/lifecycle-participants.test.ts`
      // and by the CLI integration file beside this one.
      participants: [],
    };

    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const order = graph.topologicalOrder();
    expect(order).toHaveLength(DISCOVERED_MANIFESTS.length);

    const failures: string[] = [];
    for (const moduleId of order) {
      try {
        const result = await orchestrator.install(moduleId);
        if (result.state !== 'installed') {
          failures.push(`${moduleId}: unexpected state "${result.state}"`);
        }
      } catch (error) {
        const kind = error instanceof LifecycleError ? error.kind : 'unknown';
        failures.push(
          `${moduleId}: ${kind} — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    expect(
      failures,
      `every module must install once its declared dependencies are installed:\n${failures.join('\n')}`,
    ).toEqual([]);

    const installed = await db.em().find(ModuleRegistration, { state: 'installed' });
    expect(installed).toHaveLength(DISCOVERED_MANIFESTS.length);
  }, 180_000);

  it('lists every dependency of a module before the module itself', async () => {
    const manifests = DISCOVERED_MANIFESTS.map((entry) => entry.manifest);
    const graph = new ModuleDepGraph(manifests);
    const order = graph.topologicalOrder();
    const position = new Map(order.map((moduleId, index) => [moduleId, index]));

    const inversions: string[] = [];
    for (const manifest of manifests) {
      for (const dependency of manifest.dependencies) {
        if (position.get(dependency)! > position.get(manifest.id)!) {
          inversions.push(`${manifest.id} installs before its dependency ${dependency}`);
        }
      }
    }
    expect(inversions, inversions.join('; ')).toEqual([]);
  });
});
