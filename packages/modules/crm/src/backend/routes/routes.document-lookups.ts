import type { FastifyInstance } from 'fastify';
import { OpportunityQuoteRequestLookupQuerySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { CrmDocumentLookupService } from '../services/crm-document-lookup-service.js';
import { QUOTE_REQUESTS_READ_PERMISSION } from '../services/owner-read-permissions.js';

export interface DocumentLookupRoutesDeps {
  documentLookupService: CrmDocumentLookupService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The Quote Requests an Opportunity's link picker chooses from
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §10a). Gated
 * `crm:write`: a document is chosen only to be linked, and a link is a write —
 * **and `rfqs:handle`**, the code the Quote Requests module reads one with
 * (research N-R13): the answer names an Organization's Quote Requests and their
 * statuses, and linking one asks for the same code.
 */
export async function registerCrmDocumentLookupRoutes(
  app: FastifyInstance,
  deps: DocumentLookupRoutesDeps,
): Promise<void> {
  const { requireAdmin, documentLookupService: lookups } = deps;

  app.get(
    '/api/v1/admin/crm/lookups/quote-requests',
    { preHandler: [requireAdmin('crm:write'), requireAdmin(QUOTE_REQUESTS_READ_PERMISSION)] },
    async (request) => ({
      data: await lookups.quoteRequests(
        OpportunityQuoteRequestLookupQuerySchema.parse(request.query ?? {}),
      ),
    }),
  );
}
