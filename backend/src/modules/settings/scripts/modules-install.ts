import { initOrm, closeOrm } from '../../../db/index.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ManifestReconciler } from '../services/manifest-reconciler.js';
import { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import {
  listKnownModuleCodes,
  loadManifestByModuleCode,
} from './module-manifest-loader.js';

/**
 * `pnpm --filter backend run modules:install <module-code> [--force] [--dry-run]`
 *
 * Idempotently reconciles a single module's manifest into the database. This
 * is the same logic boot-time sync runs in `composeApp()`; the CLI is for
 * ad-hoc runs (eg. registering a third-party module without a redeploy).
 *
 * Exit codes (per contract section D-1):
 *   - 0  success
 *   - 64 misuse / bad args
 *   - 65 manifest invalid
 *   - 66 conflict (SettingCodeConflict / GroupCodeConflict / BreakingChangeRejected)
 *   - 70 internal error
 */
async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const moduleCode = argv.find((a) => !a.startsWith('--'));
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');

  if (!moduleCode) {
    process.stderr.write(
      'usage: modules:install <module-code> [--force] [--dry-run]\n' +
        `known modules: ${listKnownModuleCodes().join(', ')}\n`,
    );
    return 64;
  }

  const manifest = loadManifestByModuleCode(moduleCode);
  if (!manifest) {
    process.stderr.write(
      `unknown module "${moduleCode}". known modules: ${listKnownModuleCodes().join(', ')}\n`,
    );
    return 64;
  }

  const orm = await initOrm();
  const em = orm.em.fork() as EntityManager;
  const auditLog = new AuditLogService(() => em);

  try {
    const reconciler = new ManifestReconciler(em);
    const result = await reconciler.apply([manifest], { force, dryRun });
    const mod = result.perModule[0]!;

    if (!dryRun) {
      await auditLog.record({
        actorAdminUserId: null,
        action: 'module.settings_installed',
        objectType: 'module',
        objectId: moduleCode,
        stateAfter: {
          addedGroups: mod.addedGroups,
          addedSettings: mod.addedSettings,
          updatedGroups: mod.updatedGroups,
          updatedSettings: mod.updatedSettings,
          orphanCount: mod.orphanGroups.length + mod.orphanSettings.length,
          force,
        },
      });
    }

    process.stdout.write(
      `${dryRun ? '[dry-run] ' : ''}${moduleCode}: ` +
        `+${mod.addedGroups} groups, +${mod.addedSettings} settings, ` +
        `~${mod.updatedGroups + mod.updatedSettings} updated, ` +
        `orphans: ${mod.orphanGroups.length + mod.orphanSettings.length}\n`,
    );
    return 0;
  } catch (err: unknown) {
    const name = (err as { name?: string }).name ?? 'Error';
    if (
      name === 'SettingCodeConflict' ||
      name === 'GroupCodeConflict' ||
      name === 'BreakingChangeRejected'
    ) {
      process.stderr.write(`[conflict] ${(err as Error).message}\n`);
      return 66;
    }
    if (name === 'ManifestSchemaInvalid') {
      process.stderr.write(`[invalid] ${(err as Error).message}\n`);
      return 65;
    }
    process.stderr.write(`[internal] ${(err as Error).message}\n`);
    return 70;
  } finally {
    await closeOrm();
  }
}

void main().then((code) => {
  process.exit(code);
});
