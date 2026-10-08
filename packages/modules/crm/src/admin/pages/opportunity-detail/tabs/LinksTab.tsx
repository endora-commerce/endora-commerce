import type { ReactNode } from 'react';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage } from '@endora-commerce/admin-kit/i18n';
import { LinkedDocuments } from '../../../components/LinkedDocuments.js';
import { LinkedQuoteRequests } from '../../../components/LinkedQuoteRequests.js';
import type { OpportunityTabProps } from '../tabs.js';

/**
 * The *Links* tab of an Opportunity (User Story 20; FR-020, FR-021): the Orders
 * and the Quote Requests linked to it, each in its own section with everything
 * that section does — linking, unlinking, status following, creating a document
 * from here, and the notice shown on coming back from creating one.
 *
 * The Quote Requests section is its component's to draw or not: with that
 * module off and nothing linked it renders nothing, and this tab is the Orders
 * alone.
 */
export function LinksTab(props: OpportunityTabProps): ReactNode {
  const { opportunity, orderStatuses, reload } = props;
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');

  return (
    <div className="divide-y divide-border [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
      <LinkedDocuments
        opportunity={opportunity}
        orderStatuses={orderStatuses}
        language={language}
        canWrite={canWrite}
        reload={reload}
      />
      <LinkedQuoteRequests opportunity={opportunity} canWrite={canWrite} reload={reload} />
    </div>
  );
}

export default LinksTab;
