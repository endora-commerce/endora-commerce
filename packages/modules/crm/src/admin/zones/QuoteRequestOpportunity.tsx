import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { crmApi } from '../api.js';
import { LinkedOpportunityPanel } from '../components/LinkedOpportunityPanel.js';

/**
 * CRM's contribution to `quote_request.detail.after`: the Opportunity a Quote
 * Request belongs to, on the request's own screen. A thin wrapper — the panel
 * is the component the Order screen has; this file says the document is a
 * Quote Request and how a Quote Request's Organization is read.
 */
export type QuoteRequestOpportunityProps = AdminZoneProps<'quote_request.detail.after'>;

const loadOrganizationId = (quoteRequestId: string): Promise<string | null> =>
  crmApi.quoteRequestOrganizationId(quoteRequestId);

export function QuoteRequestOpportunity({ quoteRequestId }: QuoteRequestOpportunityProps): ReactNode {
  return (
    <LinkedOpportunityPanel
      documentKind="quote_request"
      documentId={quoteRequestId}
      loadOrganizationId={loadOrganizationId}
    />
  );
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default QuoteRequestOpportunity;
