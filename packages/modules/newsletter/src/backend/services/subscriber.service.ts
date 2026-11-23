import type { EntityManager } from '@mikro-orm/postgresql';
import { isUuidShape, type CustomerAccountReadPort, type EmailMailerPort } from '@endora-commerce/contracts';
import { randomUUID } from 'node:crypto';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSuppression } from '../entities/newsletter-suppression.entity.js';
import { makeConfirmSubscriberCommand } from '../commands/confirm-subscriber.command.js';
import { makeSubscribeSubscriberCommand } from '../commands/subscribe-subscriber.command.js';
import {
  makeSuppressSubscriberCommand,
  type SuppressionTarget,
} from '../commands/suppress-subscriber.command.js';
import { makeUnsubscribeSubscriberCommand } from '../commands/unsubscribe-subscriber.command.js';
import type { NewsletterOptInService } from './opt-in.service.js';
import type { ResolvedSubscriberOwner } from './subscriber-fields.js';

export { mergeTypedCustomFields, NEWSLETTER_CUSTOM_FIELD_TEXT_MAX } from './subscriber-fields.js';

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
  /**
   * The channel a subscriber with no origin channel belongs to, **resolved per
   * call** since `specs/117-instance-bring-up/` Phase 6.
   *
   * It was a value the composition awaited and passed in, which is what made
   * `newsletterBridge` a thing only a composition root could assemble. An
   * accessor lets this module resolve the system-default channel itself,
   * through the port the platform already contributes.
   */
  resolveDefaultChannelId: () => Promise<string | null>;
  links: NewsletterLinkBuilder;
  /**
   * `customer_accounts`' read model, for the one field the owner stamp needs:
   * the organisation the owning account belongs to (feature 087, D-187).
   *
   * **Required**. The two optional slots below it are collaborators a
   * composition may genuinely lack — a transport and an event emitter — and
   * each has a defined behaviour when absent. This one has none: there is no
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
  /**
   * Every subscriber write runs a Command on it (issue #1381, Principle XIII),
   * so the write and its one audit entry commit together. Required: a consent
   * recorded nowhere is indistinguishable from one never given.
   */
  commandBus: CommandBus;
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

  /**
   * Subscribe (idempotent on email). Returns the resulting status.
   *
   * The write is the `newsletter.subscriber.subscribe` / `.resubscribe` Command
   * (issue #1381, Principle XIII): the row and its one audit entry commit
   * together. Everything that reads another module or the settings — the opt-in
   * mode, the owner's organisation — is resolved here first, and so is whether
   * the address already has a subscriber, which fixes the action and the
   * `objectId` the entry carries. The confirmation e-mail and the
   * observability event follow the commit.
   */
  async subscribe(input: SubscribeInput): Promise<{ status: 'pending' | 'active' }> {
    const email = input.email.trim().toLowerCase();

    const channelId = input.salesChannelId;
    const settingsChannelId = channelId ?? (await this.deps.resolveDefaultChannelId());
    const mode = await this.deps.optIn.resolveMode(settingsChannelId);

    // D-187 — resolved **before** the write, so a refusal leaves no owned,
    // unattributed subscriber behind.
    const owner = await this.#resolveOwner(input.customerAccountId);

    const existing = await this.deps.emFactory().findOne(NewsletterSubscriber, { email });
    const subscriber = await this.deps.commandBus.run(
      makeSubscribeSubscriberCommand({
        subscriberId: existing?.id ?? randomUUID(),
        isNew: existing === null,
        email,
        salesChannelId: channelId,
        mode,
        owner,
        source: input.source ?? null,
        tags: input.tags,
        customFields: input.customFields,
      }),
    );

    if (subscriber.status === 'pending') {
      await this.sendConfirmation(subscriber.subscriberId, email, settingsChannelId);
    }

    this.deps.emitEvent?.('newsletter.subscribed.v1', {
      subscriberId: subscriber.subscriberId,
      email,
      status: subscriber.status,
    });

    return { status: subscriber.status === 'active' ? 'active' : 'pending' };
  }

  /**
   * Confirm a double opt-in subscriber from a signed token. Idempotent: an
   * unknown or malformed id answers `{ ok: false }`, a subscriber that is not
   * `pending` answers `{ ok: true }`, and neither runs a Command — so a
   * re-clicked link fires no hook (issue #1843). A pending one runs the
   * `newsletter.subscriber.confirm` Command (issue #1381).
   */
  async confirm(subscriberId: string): Promise<{ ok: boolean }> {
    if (!isUuidShape(subscriberId)) return { ok: false };
    const subscriber = await this.deps.emFactory().findOne(NewsletterSubscriber, { id: subscriberId });
    if (!subscriber) return { ok: false };
    if (subscriber.status !== 'pending') return { ok: true };
    await this.deps.commandBus.run(makeConfirmSubscriberCommand({ subscriberId }));
    return { ok: true };
  }

  /**
   * Unsubscribe with an optional reason; writes a suppression row. Idempotent.
   * The `newsletter_unsubscribe` Command (issue #1381); the observability event
   * follows the commit.
   */
  async unsubscribe(subscriberId: string, reason?: string): Promise<{ ok: boolean }> {
    const outcome = await this.deps.commandBus.run(makeUnsubscribeSubscriberCommand({ subscriberId, reason }));
    if (outcome.unsubscribed) {
      this.deps.emitEvent?.('newsletter.unsubscribed.v1', {
        subscriberId: outcome.unsubscribed.subscriberId,
        email: outcome.unsubscribed.email,
        reason: reason ?? null,
      });
    }
    return { ok: outcome.ok };
  }

  /**
   * Suppress an address on provider feedback (hard bounce / complaint — FR-035).
   * Writes a suppression row (idempotent) so the address is excluded from all
   * future sends regardless of targeting; a complaint/bounce suppression is NOT
   * lifted by a later re-subscribe (only an explicit unsubscribe is).
   *
   * The `newsletter_bounce` / `newsletter_complaint` Command (issue #1381).
   * Which row the entry is filed under is resolved here first: the address's
   * subscriber, or else its suppression row (#470).
   */
  async suppress(email: string, reason: 'bounce' | 'complaint', detail?: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const em = this.deps.emFactory();
    const subscriber = await em.findOne(NewsletterSubscriber, { email: normalized });
    const suppression = subscriber ? null : await em.findOne(NewsletterSuppression, { email: normalized });
    const target: SuppressionTarget = subscriber
      ? { objectType: 'newsletter_subscriber', objectId: subscriber.id }
      : {
          objectType: 'newsletter_suppression',
          objectId: suppression?.id ?? randomUUID(),
          exists: suppression !== null,
        };
    await this.deps.commandBus.run(makeSuppressSubscriberCommand({ email: normalized, reason, detail, target }));
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
    // Only the transport's refusal is named here. `logged` (issue #186) is the
    // console driver saying no mail server is configured: it has already
    // written the message to the log itself, and the delivery record says so.
    if (outcome.status === 'suppressed') {
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
