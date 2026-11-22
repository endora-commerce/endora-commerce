import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { TasksPanel } from './TasksPanel.js';

/**
 * `tasks`' contribution to `opportunity.detail.tabs`: the Tasks linked to the
 * Opportunity, as a tab of the record (`specs/183-record-tab-contributions/`
 * FR-012, FR-014). The tab names the panel, so the panel repeats no heading.
 */
export function OpportunityTasksTab({ opportunityId }: AdminZoneProps<'opportunity.detail.tabs'>): ReactNode {
  return <TasksPanel kind="opportunity" recordId={opportunityId} layout="tab" />;
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default OpportunityTasksTab;
