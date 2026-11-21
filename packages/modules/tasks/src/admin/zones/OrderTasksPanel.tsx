import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { TasksPanel } from './TasksPanel.js';

/** `tasks`' contribution to `order.detail.sidebar`: the Tasks linked to the record (User Story 6). */
export function OrderTasksPanel({ orderId }: AdminZoneProps<'order.detail.sidebar'>): ReactNode {
  return <TasksPanel kind="order" recordId={orderId} />;
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default OrderTasksPanel;
