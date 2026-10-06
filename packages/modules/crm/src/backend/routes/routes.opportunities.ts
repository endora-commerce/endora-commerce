import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateOpportunityRequestSchema,
  ERROR_CODES,
  OpportunityListQuerySchema,
  UpdateOpportunityRequestSchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityService } from '../services/opportunity-service.js';

export interface OpportunityRoutesDeps {
  opportunityService: OpportunityService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The version a client last read, from `If-Match: "<version>"`; `null` when it
 * sent none, or `*`. A header that is there and cannot be read is 400: taking
 * it for "no precondition" would turn a guarded write into an unguarded one.
 */
function parseIfMatch(request: FastifyRequest): number | null {
  const header = request.headers['if-match'];
  if (header === undefined) return null;
  const value = typeof header === 'string' ? header.trim() : '';
  if (value === '*') return null;
  const match = /^(?:"(\d{1,9})"|(\d{1,9}))$/.exec(value);
  if (!match) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      'If-Match must carry the version last read, as in the ETag: "3".',
    );
  }
  return Number(match[1] ?? match[2]);
}

function setEtag(reply: FastifyReply, version: number): void {
  reply.header('etag', `"${version}"`);
}

/**
 * Opportunities (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §1).
 *
 * Reading is `crm:read`, creating and editing `crm:write`, and deleting
 * `crm:configure` — removing a record with its history is not a step of daily
 * work. Tenant scope is ambient: an Opportunity of an Organization the caller
 * may not see answers 404 `CRM_OPPORTUNITY_NOT_FOUND`, the same as a missing
 * one.
 */
export async function registerCrmOpportunityRoutes(
  app: FastifyInstance,
  deps: OpportunityRoutesDeps,
): Promise<void> {
  const { requireAdmin, opportunityService: opportunities } = deps;

  app.get('/api/v1/admin/crm/opportunities', { preHandler: requireAdmin('crm:read') }, async (request) =>
    opportunities.list(OpportunityListQuerySchema.parse(request.query ?? {})),
  );

  app.post(
    '/api/v1/admin/crm/opportunities',
    { preHandler: requireAdmin('crm:write'), schema: { body: CreateOpportunityRequestSchema } },
    async (request, reply) => {
      const created = await opportunities.create(CreateOpportunityRequestSchema.parse(request.body));
      setEtag(reply, created.version);
      reply.code(201);
      return { data: created };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id',
    { preHandler: requireAdmin('crm:read') },
    async (request, reply) => {
      const opportunity = await opportunities.get(request.params.id);
      setEtag(reply, opportunity.version);
      return { data: opportunity };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id',
    { preHandler: requireAdmin('crm:write'), schema: { body: UpdateOpportunityRequestSchema } },
    async (request, reply) => {
      const updated = await opportunities.update(
        request.params.id,
        UpdateOpportunityRequestSchema.parse(request.body),
        parseIfMatch(request),
      );
      setEtag(reply, updated.version);
      return { data: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id',
    { preHandler: requireAdmin('crm:configure') },
    async (request, reply) => {
      await opportunities.delete(request.params.id);
      return reply.code(204).send();
    },
  );
}
