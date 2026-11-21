import type { ReactNode } from 'react';
import { RouteTabs } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  TASK_GENERAL_SETTINGS_PATH,
  TASK_PRIORITIES_PATH,
  TASK_TAGS_PATH,
  TASK_WORKFLOW_PATH,
} from '../lib/settings-paths.js';

/**
 * The strip between the four Task configuration screens (issue #1557, UX
 * audit WORK-06): Workflow | Priorities | Tags | General.
 *
 * They are one place with four views, so they take one sidebar row and this
 * strip — the pattern `settings` and `invoices` already use (Jakob) — rather
 * than three text links in the workflow screen's header and a back link on
 * each of the others. The palette still opens every one of them directly
 * (Principle XVI). All four routes are `tasks:configure`, like the row, so no
 * tab needs a gate of its own.
 */
export function TaskConfigurationTabs(): ReactNode {
  const t = useTranslation('tasks');
  return (
    <RouteTabs
      className="mb-4"
      tabs={[
        { to: TASK_WORKFLOW_PATH, label: t('configuration.tab.workflow') },
        { to: TASK_PRIORITIES_PATH, label: t('configuration.tab.priorities') },
        { to: TASK_TAGS_PATH, label: t('configuration.tab.tags') },
        { to: TASK_GENERAL_SETTINGS_PATH, label: t('configuration.tab.general') },
      ]}
    />
  );
}
