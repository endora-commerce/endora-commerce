import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { defineModuleManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';

/**
 * Integration test for FR-010 — soft uninstall preserves data (US2).
 *
 * Soft `module:uninstall` MUST run the uninstall hook with hard=false,
 * unregister the module's settings, mark the registry row as
 * uninstalled, and leave any module-owned tables/rows intact.
 */

describe('Module uninstall — soft preserves data (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: 'fixture_soft' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('soft uninstall hook receives hard=false; row state flips to uninstalled', async () => {
    let observedHard: boolean | null = null;
    const manifest = defineModuleManifest({
      id: 'fixture_soft',
      name: 'Fixture Soft',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        [
          'fixture_soft',
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

    // Seed as installed.
    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId: 'fixture_soft',
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
    });

    const result = await orchestrator.uninstall('fixture_soft', { hard: false });
    expect(result.state).toBe('uninstalled');
    expect(result.hard).toBe(false);
    expect(observedHard).toBe(false);

    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_soft' });
    expect(row?.state).toBe('uninstalled');
  }, 30_000);
});
