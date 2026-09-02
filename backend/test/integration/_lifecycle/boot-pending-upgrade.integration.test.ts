import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ModuleLifecycleOrchestrator } from '../../../src/lifecycle/services/orchestrator.js';
import { ModuleDepGraph } from '../../../src/lifecycle/services/dep-graph.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { LoadedManifestRegistry } from '../../../src/lifecycle/services/manifest-loader.js';

/**
 * Integration test for FR-019 — pending-upgrade flag (US4).
 *
 * When the registry's recorded version is older than the on-disk
 * manifest's version, status MUST emit the `pending-upgrade` flag
 * and boot MUST continue without blocking.
 */

describe('Module status — pending-upgrade flag (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: 'fixture_upgrade' });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('flags pending-upgrade when manifest version > registered version', async () => {
    // On-disk manifest version is 1.1.0; row version is 1.0.0.
    const manifest = defineModuleManifest({
      id: 'fixture_upgrade',
      name: 'Fixture Upgrade',
      version: '1.1.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([
        ['fixture_upgrade', { manifest, filePath: '<test>' }],
      ]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
    };

    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId: 'fixture_upgrade',
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

    const rows = await orchestrator.status();
    const fixture = rows.find((r) => r.id === 'fixture_upgrade');
    expect(fixture?.flags).toContain('pending-upgrade');
    expect(fixture?.version.registered).toBe('1.0.0');
    expect(fixture?.version.onDisk).toBe('1.1.0');
  }, 30_000);
});
