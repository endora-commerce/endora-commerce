import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';
import { migrationOwnershipOf } from '../../../src/db/configured-migrations.js';

/**
 * Integration test for FR-011 — hard uninstall deletes registry row
 * (US2). The registry row MUST be deleted (not flipped to
 * `uninstalled`); the uninstall hook MUST receive `hard=true`.
 *
 * The migration-revert side-effect is covered separately in
 * `uninstall-hard-scoped-migrations.integration.test.ts` against
 * fixture migrations whose tables exist on disk.
 */

describe('Module uninstall — hard deletes registry row (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: 'fixture_hard' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('hard uninstall deletes the row and signals hard=true to the hook', async () => {
    let observedHard: boolean | null = null;
    const manifest = defineModuleManifest({
      id: 'fixture_hard',
      name: 'Fixture Hard',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        [
          'fixture_hard',
          {
            manifest,
            filePath: '<test>',
            uninstallHook: async ({ hard }: { hard: boolean }) => {
              observedHard = hard;
            },
          },
        ],
      ]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
    };

    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId: 'fixture_hard',
      state: 'installed',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();

    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
      // Feature 080 (T033): this fixture module is covered and owns no
      // migration. Declaring that is what keeps the assertion below about the
      // registration row rather than about the refusal an unknown module gets.
      migrationOwnership: migrationOwnershipOf([], ['fixture_hard']),
    });

    const result = await orchestrator.uninstall('fixture_hard', { hard: true });
    expect(result.hard).toBe(true);
    expect(observedHard).toBe(true);

    // Hard uninstall deletes the row entirely.
    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_hard' });
    expect(row).toBeNull();
  }, 30_000);
});
