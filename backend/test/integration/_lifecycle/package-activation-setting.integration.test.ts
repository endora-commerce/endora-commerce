import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingGroup } from '../../../src/kernel/settings/setting-group.entity.js';
import {
  manifestEntryOrigin,
  REGISTERED_MANIFESTS,
} from '../../../src/modules/_lifecycle/registered-manifests.js';
import { buildStaticRegistry } from '../../../src/modules/_lifecycle/services/static-registry.js';
import { ModuleLifecycleOrchestrator } from '../../../src/modules/_lifecycle/services/orchestrator.js';
import { migrationOwnershipOf } from '../../../src/db/configured-migrations.js';
import { repoRoot } from '../../../src/overlay/overlay-roots.js';

/**
 * Feature 080, T046 — the operator axis of an **installed package**, end to end
 * against a real database (Principle XVII, acceptance assertion A6).
 *
 * A6 was recorded as *"a packaged module's activation Setting is never created,
 * so the operator axis has no row to switch"*, and its recorded first cause was
 * the boot settings reconcile reading bare-core `REGISTERED_MANIFESTS`. Since
 * D-157.6(b) that is no longer where a package's row comes from: a package is
 * converged by nothing at boot, so `install` — the operation that applies its
 * migrations — is its **only** author, and step 2 of `install` reconciles
 * `manifest.settings` through the kernel's `ManifestReconciler`. This file is
 * what says so, because nothing else did: the assertion lived only in the
 * acceptance runner, which needs a tarball, a throwaway instance and
 * PostgreSQL.
 *
 * It also holds the asymmetry AGENTS.md records, for a package specifically:
 *
 *   - `disable` → `enable` is a **pause**. The platform row flips, the settings
 *     are untouched, the operator's choice comes back.
 *   - soft `uninstall` → `install` is **taking the module off the table**. The
 *     settings sweep runs on soft and hard alike, so a re-install starts from
 *     the manifest default.
 *
 * `test/unit/_lifecycle/orchestrator.test.ts` asserts both halves for a core
 * module against stubs. The orchestrator reads no origin, so the interesting
 * claim is that this stays true for an entry the platform classifies as a
 * package — which is asserted here rather than assumed, from the same
 * `filePath` the resolver would carry.
 *
 * The orchestrator is built the way `scripts/install.ts` builds one: a static
 * registry over the resolved entries and no reconciler injected, because a
 * platform command composes no container (D-157.4).
 */

const MODULE_ID = 'fixture_package_activation';
const ACTIVATION_CODE = `${MODULE_ID}.activation`;

/**
 * A package's anchor is the resolved `package.json` that claimed the id
 * (`PackageModuleManifest.filePath`), which is never inside this build. The
 * fixture enters the analysis here (issue #130) — the origin is derived from
 * this path by the same function `composeApp()` uses, and asserted below.
 */
const PACKAGE_MANIFEST_PATH = join(
  repoRoot(),
  'node_modules',
  '@vendor',
  MODULE_ID,
  'package.json',
);

const fixtureManifest = defineModuleManifest({
  id: MODULE_ID,
  name: 'Fixture package activation module',
  version: '1.0.0',
  dependencies: [],
  activation: { settingCode: ACTIVATION_CODE, default: true },
  settings: defineModuleSettingsManifest({
    moduleCode: MODULE_ID,
    groups: [{ code: MODULE_ID, name: 'Fixture package activation' }],
    settings: [
      {
        code: ACTIVATION_CODE,
        name: 'Fixture package module enabled',
        groupCode: MODULE_ID,
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  }),
});

/** Exactly what `scripts/install.ts` hands the orchestrator, plus the fixture. */
function cliShapedOrchestrator(db: TestDb, redis: Redis): ModuleLifecycleOrchestrator {
  const registry = buildStaticRegistry([
    ...REGISTERED_MANIFESTS,
    { manifest: fixtureManifest, filePath: PACKAGE_MANIFEST_PATH },
  ]);
  return new ModuleLifecycleOrchestrator({
    orm: db.orm,
    redis,
    em: () => db.em(),
    auditLog: new AuditLogService(() => db.em()),
    registry,
    // The fixture owns no migration, and saying so is what lets its uninstall
    // proceed: absent this the orchestrator falls back to the committed core
    // ownership and refuses to revert a module it cannot enumerate.
    migrationOwnership: migrationOwnershipOf([], [MODULE_ID]),
    migratorFor: async () =>
      ({
        getPendingMigrations: async () => [],
        up: async () => [],
        down: async () => [],
      }) as never,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
}

async function activationRow(db: TestDb): Promise<Setting | null> {
  return db.em().findOne(Setting, { code: ACTIVATION_CODE });
}

describe('an installed package gets an activation control [integration]', () => {
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
    await db.em().nativeDelete(ModuleRegistration, { moduleId: MODULE_ID });
    await db.em().nativeDelete(Setting, { ownerModule: MODULE_ID });
    await db.em().nativeDelete(SettingGroup, { ownerModule: MODULE_ID });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  it('classifies the fixture as a package, so every case below is about one', () => {
    // Not decoration: if this reads `core`, the three cases below are a core
    // module's asymmetry re-asserted under a package's name.
    expect(manifestEntryOrigin(PACKAGE_MANIFEST_PATH)).toBe('package');
  });

  it('creates the activation Setting at the manifest default when it is installed', async () => {
    expect(await activationRow(db), 'nothing may create it before the install').toBeNull();

    const result = await cliShapedOrchestrator(db, redis).install(MODULE_ID);
    expect(result.state).toBe('installed');

    const row = await activationRow(db);
    expect(row, 'the operator axis has no row to switch without this').not.toBeNull();
    expect(row?.ownerModule).toBe(MODULE_ID);
    expect(row?.valueType).toBe('boolean');
    expect(row?.defaultValue).toBe(true);
    // No operator has chosen anything yet, so the manifest default is what the
    // resolver reads.
    expect(row?.globalValue ?? null).toBeNull();
  });

  it("disable then enable preserves the operator's choice — a pause drops no setting", async () => {
    const orchestrator = cliShapedOrchestrator(db, redis);
    await orchestrator.install(MODULE_ID);

    // The operator switches the capability off on `/platform/modules`.
    const chosen = await activationRow(db);
    chosen!.globalValue = false;
    await db.em().flush();

    await orchestrator.disable(MODULE_ID, { cascade: false });
    await orchestrator.enable(MODULE_ID);

    const after = await activationRow(db);
    expect(after, 'a platform pause must not drop the row').not.toBeNull();
    expect(
      after?.globalValue,
      "a disable/enable cycle is a pause: the operator's choice comes back",
    ).toBe(false);
  });

  it('a soft uninstall drops it, so a re-install starts from the manifest default', async () => {
    const orchestrator = cliShapedOrchestrator(db, redis);
    await orchestrator.install(MODULE_ID);
    const chosen = await activationRow(db);
    chosen!.globalValue = false;
    await db.em().flush();

    await orchestrator.uninstall(MODULE_ID, { hard: false });

    expect(
      await activationRow(db),
      'the settings sweep runs on soft and hard alike — the module is off the table',
    ).toBeNull();

    await orchestrator.install(MODULE_ID);

    const reinstalled = await activationRow(db);
    expect(reinstalled).not.toBeNull();
    expect(
      reinstalled?.globalValue ?? null,
      'taking a module off the table and putting it back starts from the manifest default',
    ).toBeNull();
    expect(reinstalled?.defaultValue).toBe(true);
  });
});
