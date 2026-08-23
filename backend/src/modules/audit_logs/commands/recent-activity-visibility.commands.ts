import { ERROR_CODES } from '@endora-commerce/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Setting } from '../../../kernel/settings/setting.entity.js';
import type { RecentActivityCatalog } from '../services/recent-activity-catalog.js';

/**
 * The operator's dashboard-visibility flip — feature 080, T042j / D-163.1,
 * Constitution XIII.
 *
 * A Command rather than a settings write for the reason the activation flip is
 * one (`_lifecycle/commands/activation.commands.ts`): there is no `setting.*`
 * Command to reuse, and `SettingsAdminService.setValue` audits by hand after
 * `em.flush()` and outside any transaction. The Setting is `hidden`, so it does
 * not render on the generic Settings screen at all — this is its only door, the
 * same asymmetry activation has.
 *
 * The refusal is taken **before** the Command opens a transaction, and it is a
 * refusal rather than a no-op: a control that silently does nothing is worse
 * than an absent one, because the operator believes they switched something.
 */

export interface SetRecentActivityVisibilityInput {
  moduleId: string;
  visible: boolean;
}

/**
 * Refuse a module that declares no eligibility, naming the difference between
 * the two axes so the message is actionable.
 */
export function assertRecentActivityVisibilityWritable(
  catalog: RecentActivityCatalog,
  moduleId: string,
): string {
  const entry = catalog.eligibleModules().find((m) => m.moduleId === moduleId);
  if (!entry) {
    throw new HttpError(
      404,
      ERROR_CODES.MODULE_NOT_FOUND,
      `Module "${moduleId}" declares no recent-activity eligibility, so it contributes ` +
        `nothing to the dashboard card and there is nothing to show or hide. Eligibility is ` +
        `the module author's declaration; only what to do with it is yours.`,
    );
  }
  return entry.settingCode;
}

export function makeSetRecentActivityVisibilityCommand(
  catalog: RecentActivityCatalog,
  input: SetRecentActivityVisibilityInput,
): Command<{ moduleId: string; visible: boolean }> {
  const settingCode = assertRecentActivityVisibilityWritable(catalog, input.moduleId);

  return {
    action: 'module.recent_activity_visibility.set',
    objectType: 'module',
    objectId: input.moduleId,
    capture: async ({ em }) => {
      const setting = await em.findOne(Setting, { code: settingCode });
      const stored = setting?.globalValue ?? setting?.defaultValue;
      return {
        moduleId: input.moduleId,
        settingCode,
        // The **resolved** answer, not the raw jsonb: `global_value` is `null`
        // both for "the operator never chose" and for a literal JSON null, so
        // recording it would leave two consecutive audit rows unable to say
        // what the module's visibility actually was at either moment. The same
        // reasoning the activation command records for itself.
        visible: typeof stored === 'boolean' ? stored : true,
      };
    },
    run: async ({ em }) => {
      const setting = await em.findOne(Setting, { code: settingCode });
      if (!setting) {
        // The row is reconciled from the derived settings manifest — at boot
        // for a module this build ships, by `install` for a package. Its
        // absence is a platform state, not an operator error.
        throw new HttpError(
          500,
          ERROR_CODES.SETTING_NOT_REGISTERED,
          `Module "${input.moduleId}" is eligible for the dashboard card, but its ` +
            `visibility setting "${settingCode}" is not registered.`,
        );
      }
      setting.globalValue = input.visible;
      await em.flush();
      return {
        result: { moduleId: input.moduleId, visible: input.visible },
        after: { moduleId: input.moduleId, settingCode, visible: input.visible },
      };
    },
  };
}
