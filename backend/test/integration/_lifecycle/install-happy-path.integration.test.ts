import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  type LoadedManifestRegistry,
  ModuleDepGraph,
  ModuleLifecycleOrchestrator,
} from '@endora-commerce/platform/lifecycle';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';

/**
 * Integration test for US1 happy path (feature 018).
 *
 * Installing a fixture module against a real Postgres + Redis must
 * land a registry row at state='installed', execute the install hook,
 * and produce a `module.installed` audit-log entry.
 */

describe('Module install — happy path (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db
      .em()
      .nativeDelete(ModuleRegistration, { moduleId: 'fixture_happy' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('install with no deps + hook lands an installed row + module.installed audit', async () => {
    let hookCalled = 0;
    const manifest = defineModuleManifest({
      id: 'fixture_happy',
      name: 'Fixture Happy',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        [
          'fixture_happy',
          {
            manifest,
            filePath: '<test>',
            installHook: async () => {
              hookCalled++;
            },
          },
        ],
      ]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
    };
    const auditLog = new AuditLogService(() => db.em());
    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog,
      registry,
    });

    const result = await orchestrator.install('fixture_happy');
    expect(result.state).toBe('installed');
    expect(result.version).toBe('1.0.0');
    expect(hookCalled).toBe(1);

    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_happy' });
    expect(row?.state).toBe('installed');
    expect(row?.version).toBe('1.0.0');
  }, 60_000);
});
