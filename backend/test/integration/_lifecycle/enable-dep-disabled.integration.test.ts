import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { defineModuleManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import type { LifecycleError } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/modules/_lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/modules/_lifecycle/services/manifest-loader.js';

/**
 * Integration test for FR-008 (enable variant) — enable refuses when
 * a declared dep is not enabled (US3).
 *
 * Trying to enable `quotes` while its dep `pricing` is `disabled`
 * MUST fail with kind=missing-deps and leave `quotes` in its prior
 * state.
 */

describe('Module enable — refuses when dep is disabled (integration)', () => {
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
      moduleId: { $in: ['fixture_pricing3', 'fixture_quotes3'] },
    });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('refuses enable with kind=missing-deps when upstream dep is disabled', async () => {
    const pricing = defineModuleManifest({
      id: 'fixture_pricing3',
      name: 'Pricing',
      version: '1.0.0',
      dependencies: [],
    });
    const quotes = defineModuleManifest({
      id: 'fixture_quotes3',
      name: 'Quotes',
      version: '1.0.0',
      dependencies: ['fixture_pricing3'],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_pricing3', { manifest: pricing, filePath: '<test>' }],
        ['fixture_quotes3', { manifest: quotes, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([pricing, quotes]),
    };

    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId: 'fixture_pricing3',
      state: 'disabled',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    em.create(ModuleRegistration, {
      moduleId: 'fixture_quotes3',
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
      await orchestrator.enable('fixture_quotes3');
    } catch (err) {
      caught = err as LifecycleError;
    }
    expect(caught?.kind).toBe('missing-deps');
    expect(caught?.details['missing']).toEqual(['fixture_pricing3']);

    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_quotes3' });
    expect(row?.state).toBe('disabled');
  }, 30_000);
});
