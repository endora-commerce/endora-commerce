import { randomBytes } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, WEBHOOK_BUILT_IN_EVENT_TYPES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Webhook } from '../entities/webhook.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { WebhookDelivery } from '../entities/webhook-delivery.entity.js';
import { subscriptionReceivesOrganization } from './event-bridge.js';

/**
 * WebhookService (T229) — admin CRUD over Webhook subscriptions plus
 * read-side queries over the WebhookDelivery audit table.
 *
 * Each created Webhook gets a freshly minted 64-char hex secret; the worker
 * uses the same secret to HMAC-sign each outbound POST.
 */
export class WebhookService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
    /**
     * Every event type a subscription can receive at this moment — the built-in
     * ones and the contributed ones whose owner is present. Asked per write, so
     * an operator's flip of a contributing module needs no restart. The default
     * is the built-in set alone: a service composed without a registry accepts
     * less, never more.
     */
    private readonly deliverableEventTypes: () => readonly string[] = () => WEBHOOK_BUILT_IN_EVENT_TYPES,
  ) {}

  /**
   * Refuse event types nothing delivers (issue #173).
   *
   * A subscription to an event that is not bridged is saved and then silent
   * forever, and its owner cannot tell "nothing happened yet" from "this will
   * never fire" — so the write is where it is stopped.
   *
   * `alreadyStored` is what keeps a subscription written before this rule
   * editable: a name the row already carries is not judged again, so such a row
   * can be renamed, re-pointed and have other types added or removed without
   * first being forced to drop it. Only a name the write *adds* must be
   * deliverable. Reads and deliveries never pass through here.
   */
  #assertDeliverable(requested: readonly string[], alreadyStored: readonly string[] = []): void {
    const accepted = new Set<string>([...this.deliverableEventTypes(), ...alreadyStored]);
    const refused = [...new Set(requested)].filter((eventType) => !accepted.has(eventType));
    if (refused.length === 0) return;
    const eventTypes = refused.join(', ');
    throw new HttpError(
      422,
      ERROR_CODES.WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE,
      `These event types are not delivered to webhooks: ${eventTypes}. Subscribe only to event types the Webhooks screen offers.`,
      { eventTypes },
    );
  }

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'webhook', objectId, stateBefore, stateAfter });
    }
  }

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
    /** Feature 062 — optional org binding; null/omitted = platform-wide. */
    organizationId?: string | null;
    createdByAdminUserId?: string;
  }): Promise<Webhook> {
    this.#assertDeliverable(input.eventTypes);
    const em = this.emFactory();
    const webhook = em.create(Webhook, {
      name: input.name,
      url: input.url,
      eventTypes: input.eventTypes,
      secret: randomBytes(32).toString('hex'),
      organizationId: input.organizationId ?? null,
      ...(input.createdByAdminUserId !== undefined
        ? { createdByAdminUserId: input.createdByAdminUserId }
        : {}),
    });
    em.persist(webhook);
    this.#audit(em, 'webhook.create', webhook.id, null, {
      name: webhook.name,
      url: webhook.url,
      organizationId: webhook.organizationId ?? null,
    });
    await em.flush();
    return webhook;
  }

  async update(
    id: string,
    patch: {
      name?: string | undefined;
      url?: string | undefined;
      eventTypes?: string[] | undefined;
      status?: 'active' | 'paused' | undefined;
      /** Feature 062 — set to bind, null to make platform-wide. */
      organizationId?: string | null | undefined;
    },
  ): Promise<Webhook> {
    const em = this.emFactory();
    const webhook = await em.findOne(Webhook, { id });
    if (!webhook) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Webhook not found.');
    if (patch.eventTypes !== undefined) this.#assertDeliverable(patch.eventTypes, webhook.eventTypes);
    if (patch.name !== undefined) webhook.name = patch.name;
    if (patch.url !== undefined) webhook.url = patch.url;
    if (patch.eventTypes !== undefined) webhook.eventTypes = patch.eventTypes;
    if (patch.status !== undefined) webhook.status = patch.status;
    if (patch.organizationId !== undefined) webhook.organizationId = patch.organizationId;
    this.#audit(em, 'webhook.update', webhook.id, null, {
      name: webhook.name,
      status: webhook.status,
      organizationId: webhook.organizationId ?? null,
    });
    await em.flush();
    return webhook;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const webhook = await em.findOne(Webhook, { id });
    if (!webhook) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Webhook not found.');
    this.#audit(em, 'webhook.delete', webhook.id, { name: webhook.name }, null);
    await em.removeAndFlush(webhook);
  }

  /**
   * Re-queue a failed or dead-lettered delivery: copy the source delivery into
   * a fresh `pending` row referencing the same event/payload. The actual
   * outbound POST is performed by the BullMQ worker once the job is enqueued
   * by the production composition root; the new row is the audit trail.
   *
   * Only `failed` and `dead_lettered` rows can be replayed — calling this on
   * an already-pending or successful row is a no-op signalled via 409.
   */
  async replay(deliveryId: string): Promise<WebhookDelivery> {
    // command-coverage-ignore: delivery execution/bookkeeping — the config write
    // is audited separately; this is provider dispatch state.
    const em = this.emFactory();
    const source = await em.findOne(WebhookDelivery, { id: deliveryId });
    if (!source) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Webhook delivery not found.');
    }
    if (source.status !== 'failed' && source.status !== 'dead_lettered') {
      throw new HttpError(
        409,
        ERROR_CODES.WEBHOOK_DELIVERY_NOT_REPLAYABLE,
        `Only failed or dead-lettered deliveries can be replayed (status=${source.status}).`,
      );
    }
    const copy = em.create(WebhookDelivery, {
      webhookId: source.webhookId,
      eventId: source.eventId,
      eventType: source.eventType,
      payload: source.payload,
      status: 'pending',
      attemptCount: 0,
    });
    await em.persistAndFlush(copy);
    return copy;
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
   *
   * Feature 062 (contracts/order-webhooks.md §2): `organizationId` is the
   * value extracted from the event payload. Platform-wide subscriptions
   * (`organizationId` NULL) always match; org-bound subscriptions match only
   * their own organization's events and never an event without one
   * (fail closed — Principle XI).
   */
  async findActiveByEventType(
    eventType: string,
    organizationId: string | null,
  ): Promise<Array<{ webhookId: string; url: string; secret: string }>> {
    const em = this.emFactory();
    const rows = await em.find(Webhook, { status: 'active' });
    return rows
      .filter((w) => w.eventTypes.includes(eventType))
      .filter((w) => subscriptionReceivesOrganization(w.organizationId ?? null, organizationId))
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
    // command-coverage-ignore: delivery execution/bookkeeping — the config write
    // is audited separately; this is provider dispatch state.
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
