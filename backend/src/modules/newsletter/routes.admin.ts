import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createCampaignRequestSchema,
  updateCampaignRequestSchema,
  setCampaignGroupRequestSchema,
  sendCampaignRequestSchema,
  previewCampaignRequestSchema,
  createSubscriberRequestSchema,
} from '@b2b/contracts';
import type { NewsletterCampaignService } from './services/campaign.service.js';
import type { NewsletterSubscriberService } from './services/subscriber.service.js';

export interface NewsletterAdminDeps {
  campaigns: NewsletterCampaignService;
  subscribers: NewsletterSubscriberService;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const READ = 'newsletter:read';
const WRITE = 'newsletter:write';

/** Admin newsletter routes (feature 048). All under /api/v1/admin/newsletter. */
export async function registerNewsletterAdminRoutes(
  app: FastifyInstance,
  deps: NewsletterAdminDeps,
): Promise<void> {
  const base = '/api/v1/admin/newsletter';

  // --- Campaigns ---------------------------------------------------------
  app.get(`${base}/campaigns`, { preHandler: deps.requireAdmin(READ) }, async (_req, reply) => {
    return reply.send({ data: await deps.campaigns.list() });
  });

  app.get(`${base}/campaigns/:id`, { preHandler: deps.requireAdmin(READ) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ data: await deps.campaigns.get(id) });
  });

  app.post(`${base}/campaigns`, { preHandler: deps.requireAdmin(WRITE) }, async (req, reply) => {
    const body = createCampaignRequestSchema.parse(req.body);
    return reply.status(201).send({ data: await deps.campaigns.create(body) });
  });

  app.put(`${base}/campaigns/:id`, { preHandler: deps.requireAdmin(WRITE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateCampaignRequestSchema.parse(req.body);
    return reply.send({ data: await deps.campaigns.update(id, body) });
  });

  app.put(`${base}/campaigns/:id/group`, { preHandler: deps.requireAdmin(WRITE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = setCampaignGroupRequestSchema.parse(req.body);
    return reply.send({ data: await deps.campaigns.setGroup(id, body.subscriberIds) });
  });

  app.post(`${base}/campaigns/:id/preview`, { preHandler: deps.requireAdmin(READ) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = previewCampaignRequestSchema.parse(req.body ?? {});
    return reply.send({ data: await deps.campaigns.preview(id, body.subscriberId) });
  });

  app.post(`${base}/campaigns/:id/send`, { preHandler: deps.requireAdmin(WRITE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = sendCampaignRequestSchema.parse(req.body);
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined;
    return reply.send({ data: await deps.campaigns.send(id, body.expectedVersion, scheduledAt) });
  });

  app.post(`${base}/campaigns/:id/cancel`, { preHandler: deps.requireAdmin(WRITE) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = sendCampaignRequestSchema.pick({ expectedVersion: true }).parse(req.body);
    return reply.send({ data: await deps.campaigns.cancel(id, body.expectedVersion) });
  });

  // --- Subscribers (manual / API create) ---------------------------------
  app.post(`${base}/subscribers`, { preHandler: deps.requireAdmin(WRITE) }, async (req, reply) => {
    const body = createSubscriberRequestSchema.parse(req.body);
    const result = await deps.subscribers.subscribe({
      email: body.email,
      salesChannelId: body.salesChannelId ?? null,
      source: body.source ?? 'api',
      ...(body.tags ? { tags: body.tags } : {}),
      ...(body.customFields ? { customFields: body.customFields } : {}),
    });
    return reply.status(201).send({ data: result });
  });
}
