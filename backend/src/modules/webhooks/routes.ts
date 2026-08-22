import type { FastifyInstance } from 'fastify';
import { createWebhookRequestSchema, updateWebhookRequestSchema } from '@endora-commerce/contracts';
import type { WebhookService } from './services/webhook-service.js';
import type { Webhook } from './entities/webhook.entity.js';
import type { WebhookDelivery } from './entities/webhook-delivery.entity.js';
import { testAdminUserId } from '../../http/test-actor-carrier.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface WebhooksAdminDeps {
  webhookService: WebhookService;
  requireAdmin: RequireAdminFactory;
}

export async function registerWebhooksAdminRoutes(
  app: FastifyInstance,
  deps: WebhooksAdminDeps,
): Promise<void> {
  const { webhookService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/webhooks',
    { preHandler: requireAdmin('integrations:manage') },
    async () => {
      const rows = await webhookService.list();
      return { data: rows.map(serializeWebhook) };
    },
  );

  app.post(
    '/api/v1/admin/webhooks',
    {
      preHandler: requireAdmin('integrations:manage'),
      schema: { body: createWebhookRequestSchema },
    },
    async (request, reply) => {
      const body = createWebhookRequestSchema.parse(request.body);
      const adminId = testAdminUserId(request);
      const w = await webhookService.create({
        name: body.name,
        url: body.url,
        eventTypes: body.eventTypes,
        // Feature 062 — optional organization binding (additive).
        organizationId: body.organizationId ?? null,
        ...(adminId !== undefined ? { createdByAdminUserId: adminId } : {}),
      });
      reply.status(201);
      // Reveal the signing secret once, on creation, so the operator can share
      // it with the receiving system (it is never returned by the list/update
      // endpoints again).
      return { data: { ...serializeWebhook(w), secret: w.secret } };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/webhooks/:id',
    {
      preHandler: requireAdmin('integrations:manage'),
      schema: { body: updateWebhookRequestSchema },
    },
    async (request) => {
      const body = updateWebhookRequestSchema.parse(request.body);
      const w = await webhookService.update(request.params.id, body);
      return { data: serializeWebhook(w) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/webhooks/:id',
    { preHandler: requireAdmin('integrations:manage') },
    async (request, reply) => {
      await webhookService.remove(request.params.id);
      return reply.status(204).send();
    },
  );

  app.get<{ Querystring: { webhookId?: string; status?: string; limit?: string } }>(
    '/api/v1/admin/webhooks/deliveries',
    { preHandler: requireAdmin('integrations:manage') },
    async (request) => {
      const { webhookId, status, limit } = request.query;
      const rows = await webhookService.listDeliveries({
        ...(webhookId ? { webhookId } : {}),
        ...(status
          ? { status: status as 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'dead_lettered' }
          : {}),
        ...(limit ? { limit: Number(limit) } : {}),
      });
      return { data: rows.map(serializeDelivery) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/webhooks/deliveries/:id/replay',
    { preHandler: requireAdmin('integrations:manage') },
    async (request, reply) => {
      const copy = await webhookService.replay(request.params.id);
      reply.status(202);
      return { data: serializeDelivery(copy) };
    },
  );
}

function serializeWebhook(w: Webhook): Record<string, unknown> {
  return {
    id: w.id,
    name: w.name,
    url: w.url,
    eventTypes: w.eventTypes,
    status: w.status,
    organizationId: w.organizationId ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function serializeDelivery(d: WebhookDelivery): Record<string, unknown> {
  return {
    id: d.id,
    webhookId: d.webhookId,
    eventId: d.eventId,
    eventType: d.eventType,
    status: d.status,
    attemptCount: d.attemptCount,
    dispatchedAt: d.dispatchedAt?.toISOString() ?? null,
    completedAt: d.completedAt?.toISOString() ?? null,
    deadLetteredAt: d.deadLetteredAt?.toISOString() ?? null,
    lastResponseStatus: d.lastResponseStatus ?? null,
    lastError: d.lastError ?? null,
    createdAt: d.createdAt.toISOString(),
  };
}
