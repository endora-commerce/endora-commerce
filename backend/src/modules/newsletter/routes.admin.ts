import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createCampaignRequestSchema,
  updateCampaignRequestSchema,
  setCampaignGroupRequestSchema,
  sendCampaignRequestSchema,
  previewCampaignRequestSchema,
  createSubscriberRequestSchema,
  subscriberListQuerySchema,
  unsubscribeSubscriberRequestSchema,
  createNewsletterTagRequestSchema,
  updateNewsletterTagRequestSchema,
  createNewsletterCustomFieldRequestSchema,
  updateNewsletterCustomFieldRequestSchema,
  createAutomationRequestSchema,
  updateAutomationRequestSchema,
  automationActionRequestSchema,
  putProviderRequestSchema,
} from '@b2b/contracts';
import { z } from 'zod';
import type { NewsletterCampaignService } from './services/campaign.service.js';
import type { NewsletterSubscriberService } from './services/subscriber.service.js';
import type { NewsletterSubscriberAdminService } from './services/subscriber-admin.service.js';
import type { NewsletterTagService } from './services/tag.service.js';
import type { NewsletterCustomFieldService } from './services/custom-field.service.js';
import type { NewsletterAutomationService } from './services/automation.service.js';
import type { NewsletterStatsService } from './services/stats.service.js';
import type { NewsletterProviderAdminService } from './services/provider-admin.service.js';
import type { AdminAuditContext } from './services/provider-admin.types.js';

export interface NewsletterAdminDeps {
  campaigns: NewsletterCampaignService;
  subscribers: NewsletterSubscriberService;
  subscriberAdmin: NewsletterSubscriberAdminService;
  tags: NewsletterTagService;
  customFields: NewsletterCustomFieldService;
  automations: NewsletterAutomationService;
  stats: NewsletterStatsService;
  providerAdmin: NewsletterProviderAdminService;
  resolveAuditContext: (req: FastifyRequest) => AdminAuditContext;
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
  const read = { preHandler: deps.requireAdmin(READ) };
  const write = { preHandler: deps.requireAdmin(WRITE) };
  const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;

  // --- Campaigns ---------------------------------------------------------
  app.get(`${base}/campaigns`, read, async (_req, reply) => reply.send({ data: await deps.campaigns.list() }));
  app.get(`${base}/campaigns/:id`, read, async (req, reply) =>
    reply.send({ data: await deps.campaigns.get(idOf(req)) }),
  );
  app.post(`${base}/campaigns`, write, async (req, reply) =>
    reply.status(201).send({ data: await deps.campaigns.create(createCampaignRequestSchema.parse(req.body)) }),
  );
  app.put(`${base}/campaigns/:id`, write, async (req, reply) =>
    reply.send({ data: await deps.campaigns.update(idOf(req), updateCampaignRequestSchema.parse(req.body)) }),
  );
  app.put(`${base}/campaigns/:id/group`, write, async (req, reply) =>
    reply.send({
      data: await deps.campaigns.setGroup(idOf(req), setCampaignGroupRequestSchema.parse(req.body).subscriberIds),
    }),
  );
  app.post(`${base}/campaigns/:id/preview`, read, async (req, reply) => {
    const body = previewCampaignRequestSchema.parse(req.body ?? {});
    return reply.send({ data: await deps.campaigns.preview(idOf(req), body.subscriberId) });
  });
  app.post(`${base}/campaigns/:id/send`, write, async (req, reply) => {
    const body = sendCampaignRequestSchema.parse(req.body);
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined;
    return reply.send({ data: await deps.campaigns.send(idOf(req), body.expectedVersion, scheduledAt) });
  });
  app.post(`${base}/campaigns/:id/cancel`, write, async (req, reply) => {
    const body = sendCampaignRequestSchema.pick({ expectedVersion: true }).parse(req.body);
    return reply.send({ data: await deps.campaigns.cancel(idOf(req), body.expectedVersion) });
  });
  app.get(`${base}/campaigns/:id/stats`, read, async (req, reply) =>
    reply.send({ data: await deps.stats.campaignStats(idOf(req)) }),
  );

  // --- Subscribers -------------------------------------------------------
  app.get(`${base}/subscribers`, read, async (req, reply) => {
    const query = subscriberListQuerySchema.parse(req.query);
    return reply.send({ data: await deps.subscriberAdmin.list(query) });
  });
  app.get(`${base}/subscribers/export`, read, async (req, reply) => {
    const query = subscriberListQuerySchema.partial().parse(req.query);
    const csv = await deps.subscriberAdmin.exportCsv(query);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="newsletter-subscribers.csv"');
    return reply.send(csv);
  });
  app.get(`${base}/subscribers/:id`, read, async (req, reply) =>
    reply.send({ data: await deps.subscriberAdmin.getDetail(idOf(req)) }),
  );
  app.post(`${base}/subscribers`, write, async (req, reply) => {
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
  app.post(`${base}/subscribers/:id/unsubscribe`, write, async (req, reply) => {
    const body = unsubscribeSubscriberRequestSchema.parse(req.body);
    await deps.subscribers.unsubscribe(idOf(req), body.reason);
    return reply.send({ data: await deps.subscriberAdmin.getDetail(idOf(req)) });
  });
  app.post(`${base}/subscribers/:id/deactivate`, write, async (req, reply) => {
    const body = z.object({ expectedVersion: z.number().int() }).parse(req.body);
    return reply.send({ data: await deps.subscriberAdmin.deactivate(idOf(req), body.expectedVersion) });
  });
  app.delete(`${base}/subscribers/:id`, write, async (req, reply) => {
    await deps.subscriberAdmin.remove(idOf(req));
    return reply.status(204).send();
  });

  // --- Tags --------------------------------------------------------------
  app.get(`${base}/tags`, read, async (_req, reply) => reply.send({ data: { items: await deps.tags.list() } }));
  app.post(`${base}/tags`, write, async (req, reply) =>
    reply.status(201).send({ data: await deps.tags.create(createNewsletterTagRequestSchema.parse(req.body)) }),
  );
  app.patch(`${base}/tags/:id`, write, async (req, reply) =>
    reply.send({ data: await deps.tags.update(idOf(req), updateNewsletterTagRequestSchema.parse(req.body)) }),
  );
  app.delete(`${base}/tags/:id`, write, async (req, reply) => {
    await deps.tags.remove(idOf(req));
    return reply.status(204).send();
  });

  // --- Custom fields -----------------------------------------------------
  app.get(`${base}/custom-fields`, read, async (_req, reply) =>
    reply.send({ data: { items: await deps.customFields.list() } }),
  );
  app.post(`${base}/custom-fields`, write, async (req, reply) =>
    reply
      .status(201)
      .send({ data: await deps.customFields.create(createNewsletterCustomFieldRequestSchema.parse(req.body)) }),
  );
  app.patch(`${base}/custom-fields/:id`, write, async (req, reply) =>
    reply.send({
      data: await deps.customFields.update(idOf(req), updateNewsletterCustomFieldRequestSchema.parse(req.body)),
    }),
  );
  app.delete(`${base}/custom-fields/:id`, write, async (req, reply) => {
    await deps.customFields.remove(idOf(req));
    return reply.status(204).send();
  });

  // --- Automations -------------------------------------------------------
  app.get(`${base}/automations`, read, async (_req, reply) =>
    reply.send({ data: await deps.automations.list() }),
  );
  app.get(`${base}/automations/:id`, read, async (req, reply) =>
    reply.send({ data: await deps.automations.get(idOf(req)) }),
  );
  app.post(`${base}/automations`, write, async (req, reply) =>
    reply.status(201).send({ data: await deps.automations.create(createAutomationRequestSchema.parse(req.body)) }),
  );
  app.put(`${base}/automations/:id`, write, async (req, reply) =>
    reply.send({ data: await deps.automations.update(idOf(req), updateAutomationRequestSchema.parse(req.body)) }),
  );
  app.post(`${base}/automations/:id/activate`, write, async (req, reply) =>
    reply.send({
      data: await deps.automations.activate(idOf(req), automationActionRequestSchema.parse(req.body).expectedVersion),
    }),
  );
  app.post(`${base}/automations/:id/pause`, write, async (req, reply) =>
    reply.send({
      data: await deps.automations.pause(idOf(req), automationActionRequestSchema.parse(req.body).expectedVersion),
    }),
  );

  // --- Sending provider --------------------------------------------------
  app.get(`${base}/provider`, read, async (_req, reply) =>
    reply.send({ data: await deps.providerAdmin.getConfig() }),
  );
  app.put(`${base}/provider`, write, async (req, reply) => {
    const body = putProviderRequestSchema.parse(req.body);
    return reply.send({ data: await deps.providerAdmin.putConfig(body, deps.resolveAuditContext(req)) });
  });
  app.post(`${base}/provider/test`, write, async (_req, reply) =>
    reply.send({ data: await deps.providerAdmin.test() }),
  );
}
