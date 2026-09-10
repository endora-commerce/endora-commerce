import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineModuleManifest } from '@endora-commerce/contracts';
import type { IMigrator } from '@mikro-orm/core';
import { platformSourceRootAt } from '../../../scripts/lib/platform-root.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  type LoadedManifestRegistry,
  ModuleDepGraph,
  ModuleLifecycleOrchestrator,
} from '@endora-commerce/platform/lifecycle';
import { ModuleRegistration } from '@endora-commerce/platform/composition';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import {
  coreMigrationOwnership,
  migrationOwnershipOf,
} from '../../../src/db/configured-migrations.js';

/**
 * Hard uninstall must revert the target module's migrations.
 *
 * Before feature 065 this path scanned `src/db/migrations/` for filenames
 * matching `^\d+_<moduleId>_` and passed the basename as the migration name.
 * Both halves were wrong: module migrations do not live in that directory, and
 * `mikro_orm_migrations.name` holds the **class** name. The path therefore
 * matched nothing and only logged — a silent no-op, asserted below.
 *
 * The migrator is stubbed through the `migratorFor` seam so the test proves the
 * resolution (which names, in which order) without dropping tables from the
 * shared test database.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The `core` group's own migrations directory, resolved rather than spelled.
 *
 * It was `backend/src/db/migrations` until `specs/110-instance-repository/`
 * T116 moved the twelve into the platform package. A checkout with no platform
 * member is a refusal rather than an empty listing: the assertion below is that
 * the legacy filename pattern matches *nothing in a directory that has files*,
 * and a directory that is not there would satisfy it while measuring nothing.
 */
const dbMigrationsDir = ((): string => {
  const platformRoot = platformSourceRootAt(resolve(here, '../../../..'));
  if (platformRoot === null) {
    throw new Error(
      'no workspace member declares `endora.type: "platform"`, so the `core` migrations have ' +
        'no directory and the legacy-filename assertion below would pass over an empty list.',
    );
  }
  return resolve(platformRoot, 'migrations');
})();

/** The module the assertions run against — it owns several migrations. */
const TARGET_MODULE = 'catalog';

function ownedMigrationNames(moduleId: string): string[] {
  return MIGRATION_REGISTRY.filter((entry) => entry.moduleId === moduleId).map(
    (entry) => entry.cls.name,
  );
}

interface RecordingMigrator {
  migrator: IMigrator;
  reverted: string[];
}

function recordingMigrator(): RecordingMigrator {
  const reverted: string[] = [];
  const migrator = {
    down: async (options?: { migrations?: string[] }) => {
      const names = options?.migrations ?? [];
      reverted.push(...names);
      return names.map((name) => ({ name }));
    },
    up: async () => [],
    getPendingMigrations: async () => [],
    getExecutedMigrations: async () => [],
  } as unknown as IMigrator;
  return { migrator, reverted };
}

describe('Module uninstall — migration revert resolves from the registry (integration)', () => {
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
      .nativeDelete(ModuleRegistration, { moduleId: { $in: [TARGET_MODULE, 'fixture_no_migs'] } });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  async function seedInstalled(moduleId: string): Promise<void> {
    const em = db.em();
    const now = new Date();
    em.create(ModuleRegistration, {
      moduleId,
      state: 'installed',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await em.flush();
  }

  function orchestratorFor(
    moduleId: string,
    migrator: IMigrator,
  ): ModuleLifecycleOrchestrator {
    const manifest = defineModuleManifest({
      id: moduleId,
      name: moduleId,
      version: '1.0.0',
      dependencies: [],
    });
    const registry: LoadedManifestRegistry = {
      modules: new Map([[moduleId, { manifest, filePath: '<test>' }]]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
    };
    return new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
      // The committed core registry, which is what these assertions are about:
      // which of *core's* migrations a hard uninstall reverts. It was the
      // orchestrator's own default until D-160.11 — a reach out of the platform
      // into `src/db` — so the choice is made here now, where the subject is.
      migrationOwnership: coreMigrationOwnership(),
      migratorFor: async () => migrator,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  }

  it('the pre-065 filename scan matched nothing (the bug this replaces)', () => {
    // The directory holds only the `core` migrations, and none of them — nor any
    // module migration — uses the legacy `NNN_<moduleId>_` filename.
    const legacyPattern = new RegExp(`^\\d+_${TARGET_MODULE}_`);
    const files = readdirSync(dbMigrationsDir);
    // A read that came back empty is a finding about the walk, not about the
    // filenames: the assertion under it would hold over nothing.
    expect(files.length, dbMigrationsDir).toBeGreaterThan(0);
    expect(files.filter((file) => legacyPattern.test(file))).toEqual([]);

    // Yet the module genuinely owns migrations, which is what must be reverted.
    expect(ownedMigrationNames(TARGET_MODULE).length).toBeGreaterThan(1);
  });

  it("reverts exactly the module's own migrations, newest first", async () => {
    await seedInstalled(TARGET_MODULE);
    const { migrator, reverted } = recordingMigrator();

    const result = await orchestratorFor(TARGET_MODULE, migrator).uninstall(TARGET_MODULE, {
      hard: true,
    });

    const owned = ownedMigrationNames(TARGET_MODULE);
    const expected = [...owned].sort().reverse();

    expect(reverted).toEqual(expected);
    expect(result.revertedMigrations).toEqual(expected);
    expect(reverted.length).toBeGreaterThan(1);
  }, 30_000);

  it('never touches another module’s migrations', async () => {
    await seedInstalled(TARGET_MODULE);
    const { migrator, reverted } = recordingMigrator();

    await orchestratorFor(TARGET_MODULE, migrator).uninstall(TARGET_MODULE, { hard: true });

    const foreign = MIGRATION_REGISTRY.filter((entry) => entry.moduleId !== TARGET_MODULE).map(
      (entry) => entry.cls.name,
    );
    for (const name of reverted) {
      expect(foreign).not.toContain(name);
    }
  }, 30_000);

  it('reverts nothing and warns for a module with no migrations', async () => {
    await seedInstalled('fixture_no_migs');
    const { migrator, reverted } = recordingMigrator();
    const warnings: string[] = [];

    const manifest = defineModuleManifest({
      id: 'fixture_no_migs',
      name: 'Fixture',
      version: '1.0.0',
      dependencies: [],
    });
    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry: {
        modules: new Map([['fixture_no_migs', { manifest, filePath: '<test>' }]]) as never,
        graph: new ModuleDepGraph([manifest]),
        participants: [], // no fixture module declares a lifecycle participant (feature 080, T036a)
      },
      // Feature 080 (T033): covered, and owns nothing — the branch this test
      // is about. Without the declaration the orchestrator answers from the
      // core registry, which has never heard of `fixture_no_migs`, and refuses
      // instead: a different branch answering a different question.
      migrationOwnership: migrationOwnershipOf([], ['fixture_no_migs']),
      migratorFor: async () => migrator,
      log: { info: () => {}, warn: (message) => warnings.push(message), error: () => {} },
    });

    const result = await orchestrator.uninstall('fixture_no_migs', { hard: true });

    expect(reverted).toEqual([]);
    expect(result.revertedMigrations).toEqual([]);
    expect(warnings.some((message) => message.includes('fixture_no_migs'))).toBe(true);
  }, 30_000);
});
