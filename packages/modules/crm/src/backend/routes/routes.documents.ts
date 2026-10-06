import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { DocumentOpportunityService } from '../services/document-opportunity-service.js';
import { ORDERS_READ_PERMISSION } from '../services/owner-read-permissions.js';

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
 * `orders:read` for an Order, here; `rfqs:handle` for a Quote Request, in the
 * service, after that module's presence is decided (research N-R13). The
 * answer says whether the document exists (404 or not) and whether it has an
 * Opportunity, which is something about the document; whoever is on its screen
 * holds that code already.
 *
 * The kind is validated by the service, not by a route schema: an unknown kind
 * is 422 by the contract, and a schema refusal would answer 400.
 */
export async function registerCrmDocumentRoutes(app: FastifyInstance, deps: DocumentRoutesDeps): Promise<void> {
  const { requireAdmin, documentOpportunityService } = deps;
  const requireOrdersRead = requireAdmin(ORDERS_READ_PERMISSION);
  /** Any other kind is the service's to answer, so it asks for nothing here. */
  const requireOrdersReadForAnOrder = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if ((request.params as { documentKind?: unknown }).documentKind !== 'order') return;
    await requireOrdersRead(request, reply);
  };

  app.get<{ Params: { documentKind: string; documentId: string } }>(
    '/api/v1/admin/crm/documents/:documentKind/:documentId/opportunity',
    { preHandler: [requireAdmin('crm:read'), requireOrdersReadForAnOrder] },
    async (request) => ({
      data: await documentOpportunityService.findForDocument(
        request.params.documentKind,
        request.params.documentId,
      ),
    }),
  );
}
