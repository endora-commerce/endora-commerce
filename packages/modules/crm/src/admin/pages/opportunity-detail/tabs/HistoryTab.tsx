import type { ReactNode } from 'react';
import { OpportunityHistory } from '../../../components/OpportunityHistory.js';
import type { OpportunityTabProps } from '../tabs.js';

/**
 * The *Change history* tab of an Opportunity (User Story 11): everything that
 * was done to it, newest first. Read-only — whoever may read the Opportunity
 * may read its history.
 */
export function HistoryTab(props: OpportunityTabProps): ReactNode {
  return <OpportunityHistory opportunity={props.opportunity} />;
}

export default HistoryTab;
