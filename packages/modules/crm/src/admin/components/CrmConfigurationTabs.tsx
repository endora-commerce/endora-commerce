import type { ReactNode } from 'react';
import { RouteTabs } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { CRM_CONFIGURATION_PATH, CRM_TAGS_PATH } from '../lib/configuration-paths.js';

/**
 * The strip between the CRM configuration screens (issue #1557, UX audit
 * WORK-06): Workflow | Tags.
 *
 * They were two rows of the CRM section; one row and this strip is the
 * pattern `settings`, `invoices` and the Tasks and Projects configuration use
 * (Jakob), and keeps the section short (Hick). The palette still opens both
 * directly (Principle XVI). Both routes are `crm:configure`, like the row.
 */
export function CrmConfigurationTabs(): ReactNode {
  const t = useTranslation('crm');
  return (
    <RouteTabs
      className="mb-4"
      tabs={[
        { to: CRM_CONFIGURATION_PATH, label: t('configuration.tab.workflow') },
        { to: CRM_TAGS_PATH, label: t('configuration.tab.tags') },
      ]}
    />
  );
}
