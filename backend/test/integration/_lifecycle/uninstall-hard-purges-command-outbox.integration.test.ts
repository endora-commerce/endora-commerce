import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { defineModuleManifest } from '@endora-commerce/contracts';
import type { IMigrator } from '@mikro-orm/core';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  type LoadedManifestRegistry,
  ModuleDepGraph,
  ModuleLifecycleOrchestrator,
} from '@endora-commerce/platform/lifecycle';
import { AuditLogService, ModuleRegistration } from '@endora-commerce/platform/composition';
import { coreMigrationOwnership } from '../../../src/db/configured-migrations.js';

/**
 * `specs/176-command-hooks-outbox/` T045 (FR-036) — a `--hard` uninstall of a
 * module deletes that module's `command_outbox` rows, and a soft one keeps
 * them.
 *
 * The rows are the outbox's, a kernel table: the module's own migrations never
 * name it (D-52), so its rows go through the orchestrator's own step rather
 * than through any `down()`. A soft uninstall preserves the module's data by
 * design, and an outbox row waiting for a handler module that is not present
 * is exactly that — it is delivered if the module comes back.
 *
 * Everything runs inside a rolled-back transaction, with the migrator stubbed
 * through `migratorFor`, so nothing is reverted in the shared test database.
 * The module id is a real one only so the committed core migration ownership
 * covers it; nothing of it is touched.
 */

const MODULE = 'newsletter';
const OTHER = 'outbox_uninstall_other';

function stubMigrator(): IMigrator {
  return {
    down: async () => [],
    up: async () => [],
    getPendingMigrations: async () => [],
    getExecutedMigrations: async () => [],
  } as unknown as IMigrator;
}

describe('uninstall and the command outbox (176 T045)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
    await db.em().nativeDelete(ModuleRegistration, { moduleId: MODULE });
    const now = new Date();
    db.em().create(ModuleRegistration, {
      moduleId: MODULE,
      state: 'installed',
      version: '1.0.0',
      installedAt: now,
      lastStateChangeAt: now,
      lastInstallFailedAt: null,
      lastInstallError: null,
    });
    await db.em().flush();
    for (const [hookModule, status] of [
      [MODULE, 'pending'],
      [MODULE, 'dead'],
      [MODULE, 'delivered'],
      [OTHER, 'pending'],
    ] as const) {
      await db.em().execute(
        `insert into "command_outbox" ("id", "action", "object_type", "object_id", "hook_module", "hook_id", "actor_kind", "status")
         values (?, 'organization.register', 'organization', ?, ?, 'notify', 'system', ?)`,
        [randomUUID(), randomUUID(), hookModule, status],
      );
    }
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  function orchestrator(): ModuleLifecycleOrchestrator {
    const manifest = defineModuleManifest({ id: MODULE, name: MODULE, version: '1.0.0', dependencies: [] });
    const registry: LoadedManifestRegistry = {
      modules: new Map([[MODULE, { manifest, filePath: '<test>' }]]) as never,
      graph: new ModuleDepGraph([manifest]),
      participants: [],
    };
    return new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
      migrationOwnership: coreMigrationOwnership(),
      migratorFor: async () => stubMigrator(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  }

  async function rowsByModule(): Promise<Record<string, number>> {
    const rows = await db
      .em()
      .execute<Array<{ hook_module: string; n: string }>>(
        `select "hook_module", count(*) as n from "command_outbox" where "hook_module" in (?, ?) group by "hook_module"`,
        [MODULE, OTHER],
      );
    return Object.fromEntries(rows.map((row) => [row.hook_module, Number(row.n)]));
  }

  it('a hard uninstall deletes every row of the module, in every state, and no other module’s', async () => {
    expect(await rowsByModule()).toEqual({ [MODULE]: 3, [OTHER]: 1 });
    await orchestrator().uninstall(MODULE, { hard: true });
    expect(await rowsByModule()).toEqual({ [OTHER]: 1 });
  }, 30_000);

  it('a soft uninstall keeps them', async () => {
    await orchestrator().uninstall(MODULE, { hard: false });
    expect(await rowsByModule()).toEqual({ [MODULE]: 3, [OTHER]: 1 });
  }, 30_000);
});
