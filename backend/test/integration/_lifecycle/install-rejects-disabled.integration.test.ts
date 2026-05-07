import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { defineModuleManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator, LifecycleError } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/modules/_lifecycle/entities/module-registration.entity.js';
import { AuditLogService } from '../../../src/modules/audit_logs/services/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';

/**
 * Integration test for FR-007 edge — installing a disabled module
 * must refuse with a hint to use `module:enable` instead of silently
 * promoting `disabled` → `installed`.
 */

describe('Module install — rejects when target is disabled (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: 'fixture_disabled' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('refuses install with kind=wrong-state when target is disabled', async () => {
    const manifest = defineModuleManifest({
      id: 'fixture_disabled',
      name: 'Fixture Disabled',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_disabled', { manifest, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([manifest]),
    };

    // Seed as disabled.
    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId: 'fixture_disabled',
      state: 'disabled',
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

    let caught: LifecycleError | null = null;
    try {
      await orchestrator.install('fixture_disabled');
    } catch (err) {
      caught = err as LifecycleError;
    }
    expect(caught?.kind).toBe('wrong-state');
    expect(caught?.message).toMatch(/module:enable/);

    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_disabled' });
    expect(row?.state).toBe('disabled');
  }, 30_000);
});
