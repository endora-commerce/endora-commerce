import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  META_TRIGGER_ACTIONS,
  createMetaCustomEventMappingSchema,
  updateMetaCustomEventMappingSchema,
} from '@endora-commerce/contracts';
import { META_ADS_READ_PERMISSION, META_ADS_WRITE_PERMISSION } from './manifest.js';
import type {
  MetaAuditContext,
  MetaCustomEventMappingsService,
} from './services/custom-event-mappings.service.js';

export interface MetaAdsAdminDeps {
  mappings: MetaCustomEventMappingsService;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveAuditContext: (req: FastifyRequest) => MetaAuditContext;
}

/**
 * Admin routes for the Meta Ads module (feature 064, US4). Custom-event mapping
 * CRUD plus the closed action catalogue that drives the admin picker.
 *
 * Per-channel Settings (Pixel ID, consent) are managed through the generic
 * Settings admin surface, not here.
 */
export async function registerMetaAdsAdminRoutes(
  app: FastifyInstance,
  deps: MetaAdsAdminDeps,
): Promise<void> {
  const { mappings, requireAdmin, resolveAuditContext } = deps;
  const BASE = '/api/v1/admin/meta-ads';

  app.get(
    `${BASE}/action-catalogue`,
    { preHandler: requireAdmin(META_ADS_READ_PERMISSION) },
    async () => ({ data: META_TRIGGER_ACTIONS }),
  );

  app.get(
    `${BASE}/custom-events`,
    { preHandler: requireAdmin(META_ADS_READ_PERMISSION) },
    async () => ({ data: await mappings.list() }),
  );

  app.get<{ Params: { id: string } }>(
    `${BASE}/custom-events/:id`,
    { preHandler: requireAdmin(META_ADS_READ_PERMISSION) },
    async (request) => ({ data: await mappings.get(request.params.id) }),
  );

  app.post(
    `${BASE}/custom-events`,
    { preHandler: requireAdmin(META_ADS_WRITE_PERMISSION) },
    async (request, reply) => {
      const body = createMetaCustomEventMappingSchema.parse(request.body);
      const created = await mappings.create(body, resolveAuditContext(request));
      return reply.status(201).send({ data: created });
    },
  );

  app.patch<{ Params: { id: string } }>(
    `${BASE}/custom-events/:id`,
    { preHandler: requireAdmin(META_ADS_WRITE_PERMISSION) },
    async (request) => {
      const body = updateMetaCustomEventMappingSchema.parse(request.body);
      const updated = await mappings.update(request.params.id, body, resolveAuditContext(request));
      return { data: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${BASE}/custom-events/:id`,
    { preHandler: requireAdmin(META_ADS_WRITE_PERMISSION) },
    async (request, reply) => {
      await mappings.remove(request.params.id, resolveAuditContext(request));
      return reply.status(204).send();
    },
  );
}
