import { initOrm, closeOrm } from '../../../db/index.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Setting } from '../entities/setting.entity.js';
import { SettingGroup } from '../entities/setting-group.entity.js';
import { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { listKnownModuleCodes } from './module-manifest-loader.js';

/**
 * `pnpm --filter backend run modules:uninstall <module-code>
 *      (--remove-settings | --preserve-settings)`
 *
 * Destructive operation; the flag is REQUIRED — there is no implicit default.
 *
 * `--remove-settings`: deletes every settings/setting_groups row whose
 *   `owner_module = <module-code>`, except `is_system_protected = true`. The
 *   `setting_values` rows cascade via FK.
 * `--preserve-settings`: leaves all rows in place. Useful when re-installing
 *   the module later — admin overrides come back exactly as they were.
 *
 * Exit codes (per contract section D-2 / D-1):
 *   - 0  success
 *   - 64 misuse / bad args (incl. missing required flag)
 *   - 70 internal error
 */
async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const moduleCode = argv.find((a) => !a.startsWith('--'));
  const remove = argv.includes('--remove-settings');
  const preserve = argv.includes('--preserve-settings');

  if (!moduleCode) {
    process.stderr.write(
      'usage: modules:uninstall <module-code> ' +
        '(--remove-settings | --preserve-settings)\n' +
        `known modules: ${listKnownModuleCodes().join(', ')}\n`,
    );
    return 64;
  }

  if (remove === preserve) {
    process.stderr.write(
      'exactly one of --remove-settings / --preserve-settings is required.\n',
    );
    return 64;
  }

  const orm = await initOrm();
  const em = orm.em.fork() as EntityManager;
  const auditLog = new AuditLogService(() => em);

  try {
    let settingCount = 0;
    let groupCount = 0;

    if (remove) {
      const ownedSettings = await em.find(Setting, { ownerModule: moduleCode });
      settingCount = ownedSettings.length;
      for (const s of ownedSettings) em.remove(s);

      const ownedGroups = await em.find(SettingGroup, {
        ownerModule: moduleCode,
        isSystemProtected: false,
      });
      groupCount = ownedGroups.length;
      for (const g of ownedGroups) em.remove(g);

      await em.flush();
    } else {
      // --preserve-settings: log orphan counts.
      settingCount = await em.count(Setting, { ownerModule: moduleCode });
      groupCount = await em.count(SettingGroup, { ownerModule: moduleCode });
    }

    await auditLog.record({
      actorAdminUserId: null,
      action: 'module.settings_uninstalled',
      objectType: 'module',
      objectId: moduleCode,
      stateAfter: {
        flag: remove ? 'remove' : 'preserve',
        settingCount,
        groupCount,
      },
    });

    process.stdout.write(
      `${moduleCode}: ${remove ? 'removed' : 'preserved'} ${settingCount} settings, ${groupCount} groups\n`,
    );
    return 0;
  } catch (err: unknown) {
    process.stderr.write(`[internal] ${(err as Error).message}\n`);
    return 70;
  } finally {
    await closeOrm();
  }
}

void main().then((code) => {
  process.exit(code);
});
