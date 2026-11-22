import type { RecordTabCounter } from '@endora-commerce/admin-kit/contributions';
import { tasksApi } from '../api.js';

/**
 * The count on the Opportunity's *Tasks* tab (`specs/183-record-tab-contributions/`
 * FR-013): the **open** Tasks linked to it that the reader may see — OQ-1 A,
 * owner 2026-11-21, on the Events tab's terms ("is anything still to do?").
 *
 * One `GET /tasks/count`, which applies the list's filters and its visibility
 * pre-filter, so the badge and the tab's list cannot disagree; never a capped
 * list page. Its own chunk: the kit imports it only for a reader who can see
 * the tab.
 */
const countOpenOpportunityTasks: RecordTabCounter<'opportunity.detail.tabs'> = ({ opportunityId }, signal) =>
  tasksApi.countTasksBy(
    new URLSearchParams({ linkedKind: 'opportunity', linkedId: opportunityId, statusCategory: 'open' }),
    signal,
  );

/** The default export the contribution's count factory resolves. */
export default countOpenOpportunityTasks;
