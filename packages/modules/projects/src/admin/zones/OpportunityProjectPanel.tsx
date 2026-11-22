import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { ProjectPanel } from './ProjectPanel.js';

/** `projects`' contribution to `opportunity.detail.sidebar`: the Project the record is in (User Story 6). */
export function OpportunityProjectPanel({ opportunityId }: AdminZoneProps<'opportunity.detail.sidebar'>): ReactNode {
  return <ProjectPanel kind="opportunity" recordId={opportunityId} />;
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default OpportunityProjectPanel;
