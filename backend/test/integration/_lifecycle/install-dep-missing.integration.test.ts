import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  LifecycleError,
  type LoadedManifestRegistry,
  ModuleDepGraph,
  ModuleLifecycleOrchestrator,
} from '@endora-commerce/platform/lifecycle';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';

/**
 * Integration test for FR-008 / SC-004 — missing dep blocks install
 * (feature 018 / US1).
 *
 * `module:install <id>` MUST refuse with a non-zero exit and a
 * descriptive error if any declared dependency is not currently
 * installed, naming each missing dependency. The error must surface
 * within ~1 second of the call (SC-004).
 */

describe('Module install — missing dep blocks install (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db
      .em()
      .nativeDelete(ModuleRegistration, {
        moduleId: { $in: ['fixture_a', 'fixture_b'] },
      });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('refuses with kind=missing-deps within 1 second', async () => {
    const a = defineModuleManifest({
      id: 'fixture_a',
      name: 'Fixture A',
      version: '1.0.0',
      dependencies: [],
    });
    const b = defineModuleManifest({
      id: 'fixture_b',
      name: 'Fixture B',
      version: '1.0.0',
      dependencies: ['fixture_a'],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_a', { manifest: a, filePath: '<test>' }],
        ['fixture_b', { manifest: b, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([a, b]),
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

    const start = Date.now();
    let caught: LifecycleError | null = null;
    try {
      await orchestrator.install('fixture_b');
    } catch (err) {
      caught = err as LifecycleError;
    }
    const duration = Date.now() - start;

    expect(caught).toBeInstanceOf(LifecycleError);
    expect(caught?.kind).toBe('missing-deps');
    expect(caught?.details['missing']).toEqual(['fixture_a']);
    // SC-004 — error within 1 second.
    expect(duration).toBeLessThan(1000);

    // Registry MUST remain unchanged.
    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_b' });
    expect(row).toBeNull();
  }, 30_000);
});
