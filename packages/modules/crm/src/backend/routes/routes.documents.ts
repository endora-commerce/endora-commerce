import type { FastifyInstance } from 'fastify';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { DocumentOpportunityService } from '../services/document-opportunity-service.js';

export interface DocumentRoutesDeps {
  documentOpportunityService: DocumentOpportunityService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The Opportunity of a document
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12b) — one read,
 * `crm:read`, for the panel CRM contributes to another module's detail screen.
 *
 * The kind is validated by the service, not by a route schema: an unknown kind
 * is 422 by the contract, and a schema refusal would answer 400.
 */
export async function registerCrmDocumentRoutes(app: FastifyInstance, deps: DocumentRoutesDeps): Promise<void> {
  const { requireAdmin, documentOpportunityService } = deps;

  app.get<{ Params: { documentKind: string; documentId: string } }>(
    '/api/v1/admin/crm/documents/:documentKind/:documentId/opportunity',
    { preHandler: requireAdmin('crm:read') },
    async (request) => ({
      data: await documentOpportunityService.findForDocument(
        request.params.documentKind,
        request.params.documentId,
      ),
    }),
  );
}
