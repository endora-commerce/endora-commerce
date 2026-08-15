import type { EntityManager } from '@mikro-orm/postgresql';
import type { Mailer } from '../../email/services/mailer.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterTag } from '../entities/newsletter-tag.entity.js';
import { NewsletterSubscriberTag } from '../entities/newsletter-subscriber-tag.entity.js';
import { NewsletterCustomField } from '../entities/newsletter-custom-field.entity.js';
import { NewsletterSuppression } from '../entities/newsletter-suppression.entity.js';
import type { NewsletterOptInService } from './opt-in.service.js';

export interface NewsletterLinkBuilder {
  confirm(token: string): string;
  unsubscribe(token: string): string;
}

export interface SubscribeInput {
  email: string;
  salesChannelId: string | null;
  tags?: string[];
  customFields?: Record<string, string | number | boolean | null>;
  source?: string;
  customerAccountId?: string | null;
}

export interface SubscriberServiceDeps {
  emFactory: () => EntityManager;
  optIn: NewsletterOptInService;
  /** Channel used for opt-in reads when a subscriber has no origin channel. */
  defaultChannelId: string | null;
  links: NewsletterLinkBuilder;
  mailer?: Mailer;
  auditLog?: AuditLogService;
  /** Optional observability emitter (wraps the in-process EventBus). */
  emitEvent?: (name: string, payload: Record<string, unknown>) => void;
}

/**
 * Subscriber lifecycle (feature 048, US1/US3). Email is the global identity;
 * re-submitting merges tags/custom fields. Suppression (table) overrides
 * everything. Double opt-in creates a `pending` row + confirmation mail; single
 * opt-in activates immediately.
 */
export class NewsletterSubscriberService {
  constructor(private readonly deps: SubscriberServiceDeps) {}

  /** Subscribe (idempotent on email). Returns the resulting status. */
  async subscribe(input: SubscribeInput): Promise<{ status: 'pending' | 'active' }> {
    const em = this.deps.emFactory();
    const email = input.email.trim().toLowerCase();

    const channelId = input.salesChannelId;
    const settingsChannelId = channelId ?? this.deps.defaultChannelId;
    const mode = await this.deps.optIn.resolveMode(settingsChannelId);

    // Suppressed (complaint/bounce) addresses are not silently re-subscribed.
    const suppressed = await em.findOne(NewsletterSuppression, { email });

    let subscriber = await em.findOne(NewsletterSubscriber, { email });
    const isNew = !subscriber;
    if (!subscriber) {
      subscriber = em.create(NewsletterSubscriber, {
        email,
        status: 'pending',
        source: input.source ?? null,
        salesChannelId: channelId,
        customerAccountId: input.customerAccountId ?? null,
      });
    }
    if (input.customerAccountId && !subscriber.customerAccountId) {
      subscriber.customerAccountId = input.customerAccountId;
    }

    // Activation policy: single opt-in (or already confirmed) → active now;
    // double opt-in → pending until the email link is followed.
    const wasActive = subscriber.status === 'active';
    if (mode === 'single' || subscriber.confirmedAt) {
      subscriber.status = 'active';
      subscriber.consentAt ??= new Date();
      if (mode === 'single') subscriber.confirmedAt ??= new Date();
    } else if (!wasActive) {
      subscriber.status = 'pending';
      subscriber.consentAt ??= new Date();
    }
    if (suppressed && subscriber.status === 'active') {
      // An explicit re-subscribe lifts a prior self-unsubscribe suppression.
      if (suppressed.reason === 'unsubscribe') {
        await em.removeAndFlush(suppressed);
      }
    }

    await this.mergeCustomFields(em, subscriber, input.customFields);
    await em.persistAndFlush(subscriber);
    await this.mergeTags(em, subscriber.id, input.tags);

    if (subscriber.status === 'pending') {
      await this.sendConfirmation(subscriber.id, email, settingsChannelId);
    }

    await this.deps.auditLog?.record({
      action: isNew ? 'newsletter_subscribe' : 'newsletter_resubscribe',
      objectType: 'newsletter_subscriber',
      objectId: subscriber.id,
      stateAfter: { email, status: subscriber.status, source: input.source ?? null },
    });
    this.deps.emitEvent?.('newsletter.subscribed.v1', {
      subscriberId: subscriber.id,
      email,
      status: subscriber.status,
    });

    return { status: subscriber.status === 'active' ? 'active' : 'pending' };
  }

  /** Confirm a double opt-in subscriber from a signed token. Idempotent. */
  async confirm(subscriberId: string): Promise<{ ok: boolean }> {
    const em = this.deps.emFactory();
    const subscriber = await em.findOne(NewsletterSubscriber, { id: subscriberId });
    if (!subscriber) return { ok: false };
    if (subscriber.status === 'pending') {
      subscriber.status = 'active';
      subscriber.confirmedAt = new Date();
      subscriber.consentAt ??= new Date();
      await em.persistAndFlush(subscriber);
      await this.deps.auditLog?.record({
        action: 'newsletter_confirm',
        objectType: 'newsletter_subscriber',
        objectId: subscriber.id,
        stateAfter: { status: 'active' },
      });
    }
    return { ok: true };
  }

  /** Unsubscribe with an optional reason; writes a suppression row. Idempotent. */
  async unsubscribe(subscriberId: string, reason?: string): Promise<{ ok: boolean }> {
    const em = this.deps.emFactory();
    const subscriber = await em.findOne(NewsletterSubscriber, { id: subscriberId });
    if (!subscriber) return { ok: false };
    if (subscriber.status !== 'unsubscribed') {
      subscriber.status = 'unsubscribed';
      subscriber.unsubscribedAt = new Date();
      subscriber.unsubscribeReason = reason ?? null;
      const existing = await em.findOne(NewsletterSuppression, { email: subscriber.email });
      if (!existing) {
        em.create(NewsletterSuppression, {
          email: subscriber.email,
          reason: 'unsubscribe',
          detail: reason ?? null,
        });
      }
      await em.persistAndFlush(subscriber);
      await this.deps.auditLog?.record({
        action: 'newsletter_unsubscribe',
        objectType: 'newsletter_subscriber',
        objectId: subscriber.id,
        stateAfter: { status: 'unsubscribed', reason: reason ?? null },
      });
      this.deps.emitEvent?.('newsletter.unsubscribed.v1', {
        subscriberId: subscriber.id,
        email: subscriber.email,
        reason: reason ?? null,
      });
    }
    return { ok: true };
  }

  /**
   * Suppress an address on provider feedback (hard bounce / complaint — FR-035).
   * Writes a suppression row (idempotent) so the address is excluded from all
   * future sends regardless of targeting; a complaint/bounce suppression is NOT
   * lifted by a later re-subscribe (only an explicit unsubscribe is).
   */
  async suppress(email: string, reason: 'bounce' | 'complaint', detail?: string): Promise<void> {
    const em = this.deps.emFactory();
    const normalized = email.trim().toLowerCase();
    const existing = await em.findOne(NewsletterSuppression, { email: normalized });
    if (existing) {
      existing.reason = reason;
      if (detail) existing.detail = detail;
    } else {
      em.create(NewsletterSuppression, { email: normalized, reason, detail: detail ?? null });
    }
    const subscriber = await em.findOne(NewsletterSubscriber, { email: normalized });
    if (subscriber && subscriber.status === 'active') {
      subscriber.status = 'deactivated';
      subscriber.deactivatedAt = new Date();
    }
    await em.flush();
    await this.deps.auditLog?.record({
      action: `newsletter_${reason}`,
      objectType: 'newsletter_subscriber',
      objectId: subscriber?.id ?? normalized,
      stateAfter: { email: normalized, reason },
    });
  }

  private async mergeCustomFields(
    em: EntityManager,
    subscriber: NewsletterSubscriber,
    incoming?: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    if (!incoming || Object.keys(incoming).length === 0) return;
    const defined = await em.find(NewsletterCustomField, {});
    const allowed = new Set(defined.map((f) => f.key));
    const merged = { ...subscriber.customFields };
    for (const [k, v] of Object.entries(incoming)) {
      if (allowed.has(k)) merged[k] = v;
    }
    subscriber.customFields = merged;
  }

  private async mergeTags(em: EntityManager, subscriberId: string, codes?: string[]): Promise<void> {
    if (!codes || codes.length === 0) return;
    const tags = await em.find(NewsletterTag, { code: { $in: codes } });
    for (const tag of tags) {
      const existing = await em.findOne(NewsletterSubscriberTag, { subscriberId, tagId: tag.id });
      if (!existing) em.create(NewsletterSubscriberTag, { subscriberId, tagId: tag.id });
    }
    await em.flush();
  }

  private async sendConfirmation(
    subscriberId: string,
    email: string,
    salesChannelId: string | null,
  ): Promise<void> {
    if (!this.deps.mailer) return;
    const token = await this.deps.optIn.mintConfirmToken(subscriberId, salesChannelId);
    const url = this.deps.links.confirm(token);
    await this.deps.mailer.send({
      messageId: `newsletter-confirm-${token}`,
      to: email,
      subject: 'Confirm your newsletter subscription',
      text: `Please confirm your subscription by opening this link:\n${url}\n`,
      html: `<p>Please confirm your subscription:</p><p><a href="${url}">Confirm subscription</a></p>`,
    });
  }
}
