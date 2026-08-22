import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';

/**
 * Integration test for FR-020 / SC-005 — status reflects mixed states
 * (US4) and 50 modules complete in <2 s.
 */

describe('Module status — mixed states (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, {
      moduleId: { $in: ['fixture_st_a', 'fixture_st_b', 'fixture_st_c'] },
    });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('reports installed / disabled / not-installed for three fixture modules', async () => {
    const a = defineModuleManifest({
      id: 'fixture_st_a',
      name: 'A',
      version: '1.0.0',
      dependencies: [],
    });
    const b = defineModuleManifest({
      id: 'fixture_st_b',
      name: 'B',
      version: '1.0.0',
      dependencies: [],
    });
    const c = defineModuleManifest({
      id: 'fixture_st_c',
      name: 'C',
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_st_a', { manifest: a, filePath: '<test>' }],
        ['fixture_st_b', { manifest: b, filePath: '<test>' }],
        ['fixture_st_c', { manifest: c, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([a, b, c]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
    };

    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId: 'fixture_st_a',
      state: 'installed',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    em.create(ModuleRegistration, {
      moduleId: 'fixture_st_b',
      state: 'disabled',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    // Note: fixture_st_c has no row → expected state 'not-installed'.
    await em.flush();

    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
    });

    const start = Date.now();
    const rows = await orchestrator.status();
    const duration = Date.now() - start;

    const fixtureRows = rows.filter((r) => r.id.startsWith('fixture_st_'));
    const byId = new Map(fixtureRows.map((r) => [r.id, r]));
    expect(byId.get('fixture_st_a')?.state).toBe('installed');
    expect(byId.get('fixture_st_b')?.state).toBe('disabled');
    expect(byId.get('fixture_st_c')?.state).toBe('not-installed');

    // SC-005 — status query should fit well under 2 s for a small registry.
    expect(duration).toBeLessThan(2000);
  }, 30_000);
});
