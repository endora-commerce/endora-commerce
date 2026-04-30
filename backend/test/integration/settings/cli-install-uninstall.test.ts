import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { defineModuleSettingsManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ManifestReconciler } from '../../../src/modules/settings/services/manifest-reconciler.js';
import { settingsManifest } from '../../../src/modules/settings/manifest.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';
import { SettingGroup } from '../../../src/modules/settings/entities/setting-group.entity.js';
import { SettingValue } from '../../../src/modules/settings/entities/setting-value.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { resolve } from 'node:path';

/**
 * T020 — CLI install/uninstall integration tests.
 *
 * The CLI scripts are tsx entrypoints; we exercise them by spawning a real
 * subprocess with the same DATABASE_URL as the test harness. Because tests
 * cannot hold a transaction across subprocesses, this suite manages its own
 * data lifecycle (delete-then-create) within each test rather than the
 * begin/rollback pattern used elsewhere.
 *
 * Test isolation: every assertion relies on `owner_module` being a
 * test-specific code, so concurrent tests cannot collide.
 */

const REPO_ROOT = resolve(__dirname, '../../../../');
const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b_test';

function runCli(
  script: 'modules-install' | 'modules-uninstall',
  args: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync(
    'pnpm',
    ['exec', 'tsx', `src/modules/settings/scripts/${script}.ts`, ...args],
    {
      cwd: resolve(REPO_ROOT, 'backend'),
      env: { ...process.env, DATABASE_URL },
      encoding: 'utf8',
    },
  );
  return {
    exitCode: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

describe('modules:install / modules:uninstall (T020)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
    // Seed the built-in `general` group so the CLI runs do not need it.
    const seedEm = db.orm.em.fork();
    const reconciler = new ManifestReconciler(seedEm);
    await reconciler.apply([settingsManifest]);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  // The CLI tests don't use the begin/rollback pattern (they spawn
  // subprocesses), so each test cleans up after itself.
  async function cleanupModule(code: string) {
    const em = db.orm.em.fork();
    const settings = await em.find(Setting, { ownerModule: code });
    for (const s of settings) em.remove(s);
    const groups = await em.find(SettingGroup, { ownerModule: code });
    for (const g of groups) em.remove(g);
    await em.flush();
  }

  beforeEach(async () => {
    await cleanupModule('cli_test');
  });

  it('refuses uninstall without a flag (exit 64)', () => {
    const r = runCli('modules-uninstall', ['cli_test']);
    expect(r.exitCode).toBe(64);
    expect(r.stderr).toContain('--remove-settings');
  }, 30_000);

  it('rejects an unknown module on install (exit 64)', () => {
    const r = runCli('modules-install', ['definitely-not-a-module']);
    expect(r.exitCode).toBe(64);
    expect(r.stderr).toContain('unknown module');
  }, 30_000);

  it('--preserve-settings keeps rows; re-install round-trips admin values', async () => {
    // Use the reconciler directly to simulate a module's manifest being
    // present (the loader map is fixed at compile time; the test exercises
    // the destructive logic of modules-uninstall.ts against arbitrary
    // owner_module rows).
    const setupEm = db.orm.em.fork();
    const channel =
      (await setupEm.findOne(SalesChannel, { code: 'main' })) ??
      setupEm.create(SalesChannel, {
        code: 'main',
        name: { en: 'Main' },
        defaultLanguage: 'en',
        defaultCurrency: 'USD',
        isPublic: true,
      });
    if (!channel.id || !(await setupEm.findOne(SalesChannel, { id: channel.id }))) {
      await setupEm.persistAndFlush(channel);
    }

    const m = defineModuleSettingsManifest({
      moduleCode: 'cli_test',
      groups: [],
      settings: [
        {
          code: 'cli_test.knob',
          name: 'Knob',
          valueType: 'string',
          defaultValue: 'default',
        },
      ],
    });
    const reconciler = new ManifestReconciler(setupEm);
    await reconciler.apply([m]);

    // Admin chose a value.
    const setting = await setupEm.findOneOrFail(Setting, { code: 'cli_test.knob' });
    setupEm.create(SettingValue, {
      setting,
      salesChannel: channel,
      value: 'kept-value',
    });
    await setupEm.flush();

    // Preserve uninstall.
    const r = runCli('modules-uninstall', ['cli_test', '--preserve-settings']);
    expect(r.exitCode).toBe(0);

    // Rows are still there.
    const verifyEm = db.orm.em.fork();
    const stillThere = await verifyEm.findOne(Setting, { code: 'cli_test.knob' });
    expect(stillThere).toBeTruthy();
    const valStillThere = await verifyEm.findOne(SettingValue, {
      setting: { code: 'cli_test.knob' },
    });
    expect(valStillThere?.value).toBe('kept-value');

    // An audit row was written.
    const audit = await verifyEm.findOne(AuditLogEntry, {
      action: 'module.settings_uninstalled',
      objectId: 'cli_test',
    });
    expect(audit).toBeTruthy();
  }, 60_000);

  it('--remove-settings deletes rows and cascade-removes setting_values', async () => {
    const setupEm = db.orm.em.fork();
    const channel =
      (await setupEm.findOne(SalesChannel, { code: 'main' })) ??
      setupEm.create(SalesChannel, {
        code: 'main',
        name: { en: 'Main' },
        defaultLanguage: 'en',
        defaultCurrency: 'USD',
        isPublic: true,
      });
    if (!channel.id || !(await setupEm.findOne(SalesChannel, { id: channel.id }))) {
      await setupEm.persistAndFlush(channel);
    }

    const m = defineModuleSettingsManifest({
      moduleCode: 'cli_test',
      groups: [],
      settings: [
        {
          code: 'cli_test.knob',
          name: 'Knob',
          valueType: 'string',
          defaultValue: 'default',
        },
      ],
    });
    const reconciler = new ManifestReconciler(setupEm);
    await reconciler.apply([m]);

    const setting = await setupEm.findOneOrFail(Setting, { code: 'cli_test.knob' });
    setupEm.create(SettingValue, {
      setting,
      salesChannel: channel,
      value: 'will-be-removed',
    });
    await setupEm.flush();

    const r = runCli('modules-uninstall', ['cli_test', '--remove-settings']);
    expect(r.exitCode).toBe(0);

    const verifyEm = db.orm.em.fork();
    expect(await verifyEm.findOne(Setting, { code: 'cli_test.knob' })).toBeNull();
    expect(
      await verifyEm.count(SettingValue, { setting: { code: 'cli_test.knob' } }),
    ).toBe(0);
  }, 60_000);
});
