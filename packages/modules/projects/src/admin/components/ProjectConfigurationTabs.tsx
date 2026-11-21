import type { ReactNode } from 'react';
import { RouteTabs } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  PROJECT_LOSS_REASONS_PATH,
  PROJECT_ROLES_PATH,
  PROJECT_TEMPLATES_PATH,
} from '../lib/configuration-paths.js';

/**
 * The strip between the three Project configuration screens (issue #1557, UX
 * audit WORK-06): Templates | Roles | Loss reasons.
 *
 * They were three rows of the "Projects & tasks" section, two of them for a
 * two-column dictionary. One row and this strip is the pattern `settings` and
 * `invoices` already use (Jakob), and keeps the section at the size a group
 * can be scanned at (Hick, Miller). The palette still opens every one of them
 * directly (Principle XVI). All three routes are `projects:configure`, like the
 * row, so no tab needs a gate of its own.
 */
export function ProjectConfigurationTabs(): ReactNode {
  const t = useTranslation('projects');
  return (
    <RouteTabs
      className="mb-4"
      tabs={[
        { to: PROJECT_TEMPLATES_PATH, label: t('configuration.tab.templates') },
        { to: PROJECT_ROLES_PATH, label: t('configuration.tab.roles') },
        { to: PROJECT_LOSS_REASONS_PATH, label: t('configuration.tab.lossReasons') },
      ]}
    />
  );
}
