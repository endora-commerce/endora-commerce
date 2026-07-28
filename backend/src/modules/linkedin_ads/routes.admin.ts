import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  LINKEDIN_TRIGGER_ACTIONS,
  createLinkedInConversionMappingSchema,
  updateLinkedInConversionMappingSchema,
} from '@b2b/contracts';
import {
  LINKEDIN_ADS_READ_PERMISSION,
  LINKEDIN_ADS_WRITE_PERMISSION,
} from './manifest.js';
import type {
  LinkedInAuditContext,
  LinkedInConversionMappingsService,
} from './services/conversion-mappings.service.js';

export interface LinkedInAdsAdminDeps {
  mappings: LinkedInConversionMappingsService;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveAuditContext: (req: FastifyRequest) => LinkedInAuditContext;
}

/**
 * Admin routes for the LinkedIn Ads module (feature 063, US3). Conversion-mapping
 * CRUD plus the closed action catalogue that drives the admin picker.
 *
 * Per-channel Settings (Partner ID, consent, server-side, access token) are
 * managed through the generic Settings admin surface, not here.
 */
export async function registerLinkedInAdsAdminRoutes(
  app: FastifyInstance,
  deps: LinkedInAdsAdminDeps,
): Promise<void> {
  const { mappings, requireAdmin, resolveAuditContext } = deps;
  const BASE = '/api/v1/admin/linkedin-ads';

  app.get(
    `${BASE}/action-catalogue`,
    { preHandler: requireAdmin(LINKEDIN_ADS_READ_PERMISSION) },
    async () => ({ data: LINKEDIN_TRIGGER_ACTIONS }),
  );

  app.get(
    `${BASE}/conversion-mappings`,
    { preHandler: requireAdmin(LINKEDIN_ADS_READ_PERMISSION) },
    async () => ({ data: await mappings.list() }),
  );

  app.get<{ Params: { id: string } }>(
    `${BASE}/conversion-mappings/:id`,
    { preHandler: requireAdmin(LINKEDIN_ADS_READ_PERMISSION) },
    async (request) => ({ data: await mappings.get(request.params.id) }),
  );

  app.post(
    `${BASE}/conversion-mappings`,
    { preHandler: requireAdmin(LINKEDIN_ADS_WRITE_PERMISSION) },
    async (request, reply) => {
      const body = createLinkedInConversionMappingSchema.parse(request.body);
      const created = await mappings.create(body, resolveAuditContext(request));
      return reply.status(201).send({ data: created });
    },
  );

  app.patch<{ Params: { id: string } }>(
    `${BASE}/conversion-mappings/:id`,
    { preHandler: requireAdmin(LINKEDIN_ADS_WRITE_PERMISSION) },
    async (request) => {
      const body = updateLinkedInConversionMappingSchema.parse(request.body);
      const updated = await mappings.update(
        request.params.id,
        body,
        resolveAuditContext(request),
      );
      return { data: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${BASE}/conversion-mappings/:id`,
    { preHandler: requireAdmin(LINKEDIN_ADS_WRITE_PERMISSION) },
    async (request, reply) => {
      await mappings.remove(request.params.id, resolveAuditContext(request));
      return reply.status(204).send();
    },
  );
}
