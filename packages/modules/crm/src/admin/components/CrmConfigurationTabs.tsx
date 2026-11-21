import type { ReactNode } from 'react';
import { RouteTabs } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { CRM_TAGS_PATH } from '../lib/configuration-paths.js';
import { WORKFLOW_SECTION_TABS } from '../lib/workflow-sections.js';

/**
 * The one strip of the CRM configuration: Statuses & moves | Order sync |
 * Value | Board card | Tags.
 *
 * Workflow and Tags were two rows of the CRM section; one *Configuration* row
 * and a strip is the pattern `settings`, `invoices` and the Tasks and Projects
 * configuration use (issue #1557, UX audit WORK-06 — Jakob, Hick). The workflow
 * itself is four tabs with one save model each (issue #1559, WORK-08), so they
 * sit on the same strip rather than on a second one under it: two nested tab
 * rows would ask the operator to read which level they are on. Tags is last,
 * as the one tab that is not the workflow. The palette still opens the
 * workflow and the tags directly (Principle XVI). Every route is
 * `crm:configure`, like the row.
 */
export function CrmConfigurationTabs(): ReactNode {
  const t = useTranslation('crm');
  return (
    <RouteTabs
      className="mb-4"
      tabs={[
        ...WORKFLOW_SECTION_TABS.map((tab) => ({ to: tab.path, label: t(tab.labelKey) })),
        { to: CRM_TAGS_PATH, label: t('configuration.tab.tags') },
      ]}
    />
  );
}
