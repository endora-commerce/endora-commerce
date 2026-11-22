import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { TasksPanel } from './TasksPanel.js';

/** `tasks`' contribution to `quote_request.detail.sidebar`: the Tasks linked to the record (User Story 6). */
export function QuoteRequestTasksPanel({ quoteRequestId }: AdminZoneProps<'quote_request.detail.sidebar'>): ReactNode {
  return <TasksPanel kind="quote_request" recordId={quoteRequestId} />;
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default QuoteRequestTasksPanel;
