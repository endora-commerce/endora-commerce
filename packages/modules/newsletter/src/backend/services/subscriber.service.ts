import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort, EmailMailerPort } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
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

/**
 * The owner identity a `newsletter_subscribers` row can be written from —
 * feature 087 Group B, D-187.
 *
 * The customer arm carries the organisation because
 * `newsletter_subscribers_organization_attribution_chk` requires it, and it is
 * a type of its own rather than a second optional field on
 * {@link SubscribeInput} because the caller's identity genuinely does not
 * include it: the only route that names an account
 * (`POST /api/v1/me/newsletter/subscribe`) reads it off the session, and the
 * organisation is a fact about that account which this service resolves through
 * `customer_accounts`' read port.
 *
 * Keeping the two apart is what makes "an owned subscriber with no
 * organisation" an unrepresentable argument to {@link ownerColumns} rather than
 * a line somebody has to remember. `SubscribeInput.customerAccountId` is
 * optional and nullable — the storefront route omits it entirely — so the shape
 * a forgotten stamp needs is exactly the shape the caller hands in; this type is
 * where it stops.
 */
type ResolvedSubscriberOwner =
  | { kind: 'customer'; customerAccountId: string; organizationId: string }
  | { kind: 'anonymous' };

/**
 * The two attribution columns, written together from one resolved owner.
 *
 * **Both** of this module's write sites go through it — the `em.create` on a
 * first subscribe and the adoption of an already-ownerless row — which is what
 * one function has to cover here. It needs no de-association arm, unlike
 * `pwa`'s: nothing in `newsletter` ever clears `customer_account_id`, so the
 * ownerless arm below is only ever the *initial* state of a row and never a
 * transition into one.
 */
function ownerColumns(owner: ResolvedSubscriberOwner): {
  customerAccountId: string | null;
  organizationId: string | null;
} {
  return owner.kind === 'customer'
    ? { customerAccountId: owner.customerAccountId, organizationId: owner.organizationId }
    : {
        customerAccountId: null,
        // FR-011 — a storefront sign-up belongs to no organisation, and the
        // constraint says nothing about it. On this table that is the ordinary
        // case: `POST /api/v1/newsletter/subscribe` passes no account. Who such
        // a row *should* belong to is R-6's open question and is not answered
        // here — in particular not by matching `email` against
        // `customer_accounts.email`, which is that question guessed.
        organizationId: null,
      };
}

export interface SubscriberServiceDeps {
  emFactory: () => EntityManager;
  optIn: NewsletterOptInService;
  /** Channel used for opt-in reads when a subscriber has no origin channel. */
  defaultChannelId: string | null;
  links: NewsletterLinkBuilder;
  /**
   * `customer_accounts`' read model, for the one field the owner stamp needs:
   * the organisation the owning account belongs to (feature 087, D-187).
   *
   * **Required**, and it is the one dependency in this interface that is. The
   * three optional slots beside it are collaborators a composition may
   * genuinely lack — a transport, an audit sink, an event emitter — and each
   * has a defined behaviour when absent. This one has none: there is no
   * composition in which an owned subscriber written with no organisation is
   * correct, because
   * `newsletter_subscribers_organization_attribution_chk` refuses that row.
   * Making it optional would move the failure from this constructor to a
   * Postgres error naming a constraint the caller never heard of, on the first
   * signed-in subscribe rather than at composition.
   *
   * Resolved through `lazyPort`, so a switched-off `customer_accounts` refuses
   * at the call with the 503 `MODULE_DISABLED` envelope rather than at
   * composition time.
   */
  customerAccounts: CustomerAccountReadPort;
  /** `emailMailer`, owned by `email`, as its published contract (feature 075). */
  mailer?: EmailMailerPort;
  auditLog?: AuditPort;
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

  /**
   * The organisation that owns a subscriber belonging to this account — feature
   * 087 Group B, D-187.
   *
   * Total, and refuses rather than returning `null`:
   * `customer_accounts.organization_id` is `NOT NULL` (D-178), so an account
   * that resolves always has one, and an account that does not resolve is a
   * caller naming a row that is not there. Either way there is no organisation
   * to stamp, and a subscriber written without one is a buyer hidden from the
   * representative who serves them — and absent from that representative's CSV
   * export, which is the surface R-6 is about. So the write stops here, where
   * the message can name the account, instead of at the constraint.
   */
  async #organizationOf(customerAccountId: string): Promise<string> {
    const account = await this.deps.customerAccounts.findById(customerAccountId);
    if (!account) {
      throw new Error(
        `NewsletterSubscriberService: customer account ${customerAccountId} does not resolve, ` +
          'so the subscriber it would own has no organisation to carry.',
      );
    }
    return account.organizationId;
  }

  /** The caller's owner input, with the organisation a customer owner implies. */
  async #resolveOwner(
    customerAccountId: string | null | undefined,
  ): Promise<ResolvedSubscriberOwner> {
    if (customerAccountId === null || customerAccountId === undefined) return { kind: 'anonymous' };
    return {
      kind: 'customer',
      customerAccountId,
      organizationId: await this.#organizationOf(customerAccountId),
    };
  }

  /** Subscribe (idempotent on email). Returns the resulting status. */
  async subscribe(input: SubscribeInput): Promise<{ status: 'pending' | 'active' }> {
    const em = this.deps.emFactory();
    const email = input.email.trim().toLowerCase();

    const channelId = input.salesChannelId;
    const settingsChannelId = channelId ?? this.deps.defaultChannelId;
    const mode = await this.deps.optIn.resolveMode(settingsChannelId);

    // Suppressed (complaint/bounce) addresses are not silently re-subscribed.
    const suppressed = await em.findOne(NewsletterSuppression, { email });

    // D-187 — resolved **before** the first managed entity is touched, not
    // between the account assignment and the flush. Both `em.create` and the
    // adoption below register the row with the unit of work, so a throw after
    // either would leave an owned, unattributed subscriber there for whatever
    // flushes this request next.
    const owner = await this.#resolveOwner(input.customerAccountId);

    let subscriber = await em.findOne(NewsletterSubscriber, { email });
    const isNew = !subscriber;
    if (!subscriber) {
      subscriber = em.create(NewsletterSubscriber, {
        email,
        status: 'pending',
        source: input.source ?? null,
        salesChannelId: channelId,
        // D-187 — the only place a subscriber is inserted, and the organisation
        // goes in with the account. `ownerColumns` takes a *resolved* owner, so
        // the customer branch has no shape in which the organisation could be
        // omitted; the anonymous branch has none to carry (FR-011).
        ...ownerColumns(owner),
      });
    }
    if (owner.kind === 'customer' && !subscriber.customerAccountId) {
      // The adoption: a subscriber who signed up anonymously and has now signed
      // in. D-187 — the account and the organisation move together here too.
      // `em.assign` rather than two statements, for the same reason
      // `ownerColumns` returns both columns as one value: two statements are two
      // things to remember, and the second one is the one that was never
      // written.
      em.assign(subscriber, ownerColumns(owner));
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
    const outcome = await this.deps.mailer.send({
      messageId: `newsletter-confirm-${token}`,
      to: email,
      subject: 'Confirm your newsletter subscription',
      text: `Please confirm your subscription by opening this link:\n${url}\n`,
      html: `<p>Please confirm your subscription:</p><p><a href="${url}">Confirm subscription</a></p>`,
      kind: 'newsletter_confirmation',
    });
    if (outcome.status !== 'sent') {
      // The subscriber row exists in `pending` either way; without the message
      // the double opt-in never completes, so it is named — and D-59's record
      // is what an operator reads when the subscriber says it never arrived.
      console.warn('[newsletter] the confirmation e-mail was not sent', {
        subscriberId,
        reason: outcome.reason,
      });
    }
  }
}
