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
 * Integration test for FR-012 — dependents block uninstall
 * (feature 018 / US2).
 *
 * `module:uninstall A` MUST refuse with kind=dependents-block when
 * any installed module declares A as a dependency, listing every
 * dependent. Both soft and hard variants behave identically.
 */

describe('Module uninstall — dependents block (integration)', () => {
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
        moduleId: { $in: ['fixture_pricing', 'fixture_quotes'] },
      });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('refuses uninstall of pricing when quotes (which depends on it) is installed', async () => {
    const pricing = defineModuleManifest({
      id: 'fixture_pricing',
      name: 'Pricing',
      version: '1.0.0',
      dependencies: [],
    });
    const quotes = defineModuleManifest({
      id: 'fixture_quotes',
      name: 'Quotes',
      version: '1.0.0',
      dependencies: ['fixture_pricing'],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_pricing', { manifest: pricing, filePath: '<test>' }],
        ['fixture_quotes', { manifest: quotes, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([pricing, quotes]),
    };

    // Seed both rows as installed.
    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId: 'fixture_pricing',
      state: 'installed',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    em.create(ModuleRegistration, {
      moduleId: 'fixture_quotes',
      state: 'installed',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();

    const auditLog = new AuditLogService(() => db.em());
    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog,
      registry,
    });

    let caught: LifecycleError | null = null;
    try {
      await orchestrator.uninstall('fixture_pricing', { hard: false });
    } catch (err) {
      caught = err as LifecycleError;
    }
    expect(caught).toBeInstanceOf(LifecycleError);
    expect(caught?.kind).toBe('dependents-block');
    expect(caught?.details['dependents']).toEqual(['fixture_quotes']);

    // Pricing row MUST still be installed.
    const row = await db
      .em()
      .findOne(ModuleRegistration, { moduleId: 'fixture_pricing' });
    expect(row?.state).toBe('installed');
  }, 30_000);
});
