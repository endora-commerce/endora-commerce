import type { ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { OpportunityHistory } from '../../../components/OpportunityHistory.js';
import type { OpportunityTabProps } from '../tabs.js';

/**
 * The *Change history* tab of an Opportunity (User Story 11): everything that
 * was done to it, newest first. Read-only — whoever may read the Opportunity
 * may read its history.
 *
 * Every entry of the history is an `h3`; the `h2` here is what they hang from,
 * so the page's outline does not skip a level. It is not drawn: the selected
 * tab already says "Change history" an inch above.
 */
export function HistoryTab(props: OpportunityTabProps): ReactNode {
  const t = useTranslation('crm');
  return (
    <>
      <h2 className="sr-only">{t('opportunity.tabs.history')}</h2>
      <OpportunityHistory opportunity={props.opportunity} />
    </>
  );
}

export default HistoryTab;
