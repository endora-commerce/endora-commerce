import { randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Webhook } from '../entities/webhook.entity.js';
import { WebhookDelivery } from '../entities/webhook-delivery.entity.js';

/**
 * WebhookService (T229) — admin CRUD over Webhook subscriptions plus
 * read-side queries over the WebhookDelivery audit table.
 *
 * Each created Webhook gets a freshly minted 64-char hex secret; the worker
 * uses the same secret to HMAC-sign each outbound POST.
 */
export class WebhookService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(): Promise<Webhook[]> {
    const em = this.emFactory();
    return em.find(Webhook, {}, { orderBy: { createdAt: 'desc' } });
  }

  async getById(id: string): Promise<Webhook> {
    const em = this.emFactory();
    const webhook = await em.findOne(Webhook, { id });
    if (!webhook) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Webhook not found.');
    return webhook;
  }

  async create(input: {
    name: string;
    url: string;
    eventTypes: string[];
    createdByAdminUserId?: string;
  }): Promise<Webhook> {
    const em = this.emFactory();
    const webhook = em.create(Webhook, {
      name: input.name,
      url: input.url,
      eventTypes: input.eventTypes,
      secret: randomBytes(32).toString('hex'),
      ...(input.createdByAdminUserId !== undefined
        ? { createdByAdminUserId: input.createdByAdminUserId }
        : {}),
    });
    await em.persistAndFlush(webhook);
    return webhook;
  }

  async update(
    id: string,
    patch: {
      name?: string | undefined;
      url?: string | undefined;
      eventTypes?: string[] | undefined;
      status?: 'active' | 'paused' | undefined;
    },
  ): Promise<Webhook> {
    const em = this.emFactory();
    const webhook = await em.findOne(Webhook, { id });
    if (!webhook) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Webhook not found.');
    if (patch.name !== undefined) webhook.name = patch.name;
    if (patch.url !== undefined) webhook.url = patch.url;
    if (patch.eventTypes !== undefined) webhook.eventTypes = patch.eventTypes;
    if (patch.status !== undefined) webhook.status = patch.status;
    await em.flush();
    return webhook;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const webhook = await em.findOne(Webhook, { id });
    if (!webhook) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Webhook not found.');
    await em.removeAndFlush(webhook);
  }

  async listDeliveries(filter: {
    webhookId?: string;
    status?: 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'dead_lettered';
    limit?: number;
  } = {}): Promise<WebhookDelivery[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = {};
    if (filter.webhookId) where['webhookId'] = filter.webhookId;
    if (filter.status) where['status'] = filter.status;
    return em.find(WebhookDelivery, where, {
      orderBy: { createdAt: 'desc' },
      limit: filter.limit ?? 100,
    });
  }

  /**
   * Look up active subscriptions for a given event type — used by the
   * event-bridge to decide which receivers should get a delivery.
   */
  async findActiveByEventType(
    eventType: string,
  ): Promise<Array<{ webhookId: string; url: string; secret: string }>> {
    const em = this.emFactory();
    const rows = await em.find(Webhook, { status: 'active' });
    return rows
      .filter((w) => w.eventTypes.includes(eventType))
      .map((w) => ({ webhookId: w.id, url: w.url, secret: w.secret }));
  }

  /**
   * Records an attempted delivery. The worker (webhook-delivery-worker.ts)
   * is the canonical caller via the BullMQ pipeline; this method also lets
   * tests + admin replay flows insert audit rows directly.
   */
  async recordDelivery(input: {
    webhookId: string;
    eventId: string;
    eventType: string;
    payload: unknown;
    status: WebhookDelivery['status'];
    attemptCount: number;
    lastResponseStatus?: number;
    lastError?: string;
  }): Promise<WebhookDelivery> {
    const em = this.emFactory();
    const row = em.create(WebhookDelivery, {
      webhookId: input.webhookId,
      eventId: input.eventId,
      eventType: input.eventType,
      payload: input.payload,
      status: input.status,
      attemptCount: input.attemptCount,
      ...(input.lastResponseStatus !== undefined
        ? { lastResponseStatus: input.lastResponseStatus }
        : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
    });
    await em.persistAndFlush(row);
    return row;
  }
}
