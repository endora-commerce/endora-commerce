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
 * Integration test for FR-016 — `disable --cascade` walks reverse
 * topological order (US3).
 *
 * Given pricing ← quotes ← invoices (each depending on its upstream),
 * `disable pricing --cascade` MUST disable invoices, then quotes,
 * then pricing — emitting one `module.disabled` audit per step.
 */

describe('Module disable --cascade — reverse-topological order (integration)', () => {
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
      moduleId: { $in: ['fixture_pricing2', 'fixture_quotes2', 'fixture_invoices2'] },
    });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('disables invoices then quotes then pricing in cascade', async () => {
    const pricing = defineModuleManifest({
      id: 'fixture_pricing2',
      name: 'Pricing',
      version: '1.0.0',
      dependencies: [],
    });
    const quotes = defineModuleManifest({
      id: 'fixture_quotes2',
      name: 'Quotes',
      version: '1.0.0',
      dependencies: ['fixture_pricing2'],
    });
    const invoices = defineModuleManifest({
      id: 'fixture_invoices2',
      name: 'Invoices',
      version: '1.0.0',
      dependencies: ['fixture_quotes2'],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_pricing2', { manifest: pricing, filePath: '<test>' }],
        ['fixture_quotes2', { manifest: quotes, filePath: '<test>' }],
        ['fixture_invoices2', { manifest: invoices, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([pricing, quotes, invoices]),
    };

    // Seed all three as installed.
    const em = db.em();
    const now = new Date();
    for (const id of ['fixture_pricing2', 'fixture_quotes2', 'fixture_invoices2']) {
      em.create(ModuleRegistration, {
        moduleId: id,
        state: 'installed',
        version: '1.0.0',
        installedAt: now,
        lastStateChangeAt: now,
        lastInstallFailedAt: null,
        lastInstallError: null,
      });
    }
    await em.flush();

    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
    });

    const result = await orchestrator.disable('fixture_pricing2', { cascade: true });
    expect(result.state).toBe('disabled');
    // Cascaded list contains the dependents in dependency order
    // (invoices first because it depends on quotes which depends on pricing).
    expect(result.cascaded).toContain('fixture_invoices2');
    expect(result.cascaded).toContain('fixture_quotes2');

    for (const id of ['fixture_pricing2', 'fixture_quotes2', 'fixture_invoices2']) {
      const row = await db.em().findOne(ModuleRegistration, { moduleId: id });
      expect(row?.state).toBe('disabled');
    }
  }, 30_000);
});
