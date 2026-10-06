import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { DocumentOpportunityService } from '../services/document-opportunity-service.js';
import { ORDERS_READ_PERMISSION, QUOTE_REQUESTS_READ_PERMISSION } from '../services/owner-read-permissions.js';

export interface DocumentRoutesDeps {
  documentOpportunityService: DocumentOpportunityService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The Opportunity of a document
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12b) — one read,
 * `crm:read`, for the panel CRM contributes to another module's detail screen.
 *
 * **And the read permission of the module that owns the document** —
 * `orders:read` for an Order, `rfqs:handle` for a Quote Request (research
 * N-R13). The answer says whether the document exists (404 or not) and whether
 * it has an Opportunity, which is something about the document; whoever is on
 * its screen holds that code already.
 *
 * The kind is validated by the service, not by a route schema: an unknown kind
 * is 422 by the contract, and a schema refusal would answer 400.
 */
export async function registerCrmDocumentRoutes(app: FastifyInstance, deps: DocumentRoutesDeps): Promise<void> {
  const { requireAdmin, documentOpportunityService } = deps;
  const requireOrdersRead = requireAdmin(ORDERS_READ_PERMISSION);
  const requireQuoteRequestsRead = requireAdmin(QUOTE_REQUESTS_READ_PERMISSION);
  /** An unknown kind is the service's to refuse (422), so it asks for nothing here. */
  const requireTheOwnersRead = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const kind = (request.params as { documentKind?: unknown }).documentKind;
    if (kind === 'order') await requireOrdersRead(request, reply);
    else if (kind === 'quote_request') await requireQuoteRequestsRead(request, reply);
  };

  app.get<{ Params: { documentKind: string; documentId: string } }>(
    '/api/v1/admin/crm/documents/:documentKind/:documentId/opportunity',
    { preHandler: [requireAdmin('crm:read'), requireTheOwnersRead] },
    async (request) => ({
      data: await documentOpportunityService.findForDocument(
        request.params.documentKind,
        request.params.documentId,
      ),
    }),
  );
}
