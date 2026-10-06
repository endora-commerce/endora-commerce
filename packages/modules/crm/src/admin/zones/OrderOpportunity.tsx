import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { crmApi } from '../api.js';
import { LinkedOpportunityPanel } from '../components/LinkedOpportunityPanel.js';

/**
 * CRM's contribution to `order.detail.after`: the Opportunity an Order belongs
 * to, on the Order's own screen. A thin wrapper — the panel is the same
 * component whichever document's screen it is on; this file says the document
 * is an Order and how an Order's Organization is read.
 */
export type OrderOpportunityProps = AdminZoneProps<'order.detail.after'>;

const loadOrganizationId = (orderId: string): Promise<string | null> => crmApi.orderOrganizationId(orderId);

export function OrderOpportunity({ orderId }: OrderOpportunityProps): ReactNode {
  return (
    <LinkedOpportunityPanel documentKind="order" documentId={orderId} loadOrganizationId={loadOrganizationId} />
  );
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default OrderOpportunity;
