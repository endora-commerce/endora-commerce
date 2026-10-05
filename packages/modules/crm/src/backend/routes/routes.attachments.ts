import type { FastifyInstance } from 'fastify';
import { CreateOpportunityAttachmentRequestSchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityAttachmentService } from '../services/opportunity-attachment-service.js';

export interface AttachmentRoutesDeps {
  attachmentService: OpportunityAttachmentService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Files attached to an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §7).
 *
 * Reading the list is `crm:read` and that is enough to download: each entry
 * carries a link this module resolved. No permission of the media library is
 * asked for.
 */
export async function registerCrmAttachmentRoutes(
  app: FastifyInstance,
  deps: AttachmentRoutesDeps,
): Promise<void> {
  const { requireAdmin, attachmentService: attachments } = deps;

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/attachments',
    { preHandler: requireAdmin('crm:read') },
    async (request) => ({ data: await attachments.list(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/attachments',
    { preHandler: requireAdmin('crm:write'), schema: { body: CreateOpportunityAttachmentRequestSchema } },
    async (request, reply) => {
      const body = CreateOpportunityAttachmentRequestSchema.parse(request.body);
      const { attachment, created } = await attachments.add(request.params.id, body.assetId);
      // 200, not 201, for a file the Opportunity already had: nothing was created.
      reply.code(created ? 201 : 200);
      return { data: attachment };
    },
  );

  app.delete<{ Params: { id: string; attachmentId: string } }>(
    '/api/v1/admin/crm/opportunities/:id/attachments/:attachmentId',
    { preHandler: requireAdmin('crm:write') },
    async (request, reply) => {
      await attachments.remove(request.params.id, request.params.attachmentId);
      return reply.code(204).send();
    },
  );
}
