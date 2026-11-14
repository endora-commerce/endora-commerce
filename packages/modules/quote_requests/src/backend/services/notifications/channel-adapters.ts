import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminNotificationMessage,
  AdminNotificationRecordPort,
  AdminUserReadPort,
  AdminUserRecord,
  CustomerAccountReadPort,
  CustomerAccountRecord,
  CustomerNotificationMessage,
  CustomerNotificationRecordPort,
  CustomerPushOutcome,
  CustomerPushPort,
  OrganizationDetailsPort,
  PermissionReadPort,
  TransactionalEmailSender,
  TransactionalSendOutcome,
} from '@endora-commerce/contracts';
import { LANGUAGE_FALLBACK, SUPPORTED_LANGUAGES, type SupportedLanguage } from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled, type SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import { formatQuoteDate } from '../../document/blocks/types.js';
import { QuoteRequest } from '../../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../../entities/quote-request-item.entity.js';
import { QuoteRequestRevision } from '../../entities/quote-request-revision.entity.js';
import type { ChannelAdapter, DeliveryContext, DeliveryOutcome } from './delivery-service.js';
import type { QuoteRequestNotificationChange, QuoteRequestNotificationChannel } from './notification-matrix.js';
import { RFQ_HANDLE_PERMISSION, type OrgWideViewerRoleIds } from './recipients.js';

/**
 * The delivered channels of `specs/179-rfq-and-customer-notifications/` — the
 * admin bell, the operator e-mail and the customer e-mail (Phase 1), the
 * customer notification centre (WP-08) and the push to the buyer's devices
 * (WP-10) (`contracts/notification-matrix.md` §2 – §4,
 * `contracts/delivery-and-ports.md` §3).
 *
 * Each adapter re-checks its recipient at delivery (matrix rule 4): an
 * administrator still active and holding `rfqs:handle`; a customer account
 * still live, still in the request's Organization, and still one who may open
 * the request — the requester, or a member whose role
 * {@link OrgWideViewerRoleIds} names. Anybody else closes the record
 * `skipped_no_recipient` and is told nothing (SC-003).
 *
 * Every read goes through its owner's published port; presence of the
 * channel's owner was decided by the delivery service in front of each call.
 */

/** The bell rings for the changes the matrix gives the operator side's bell (rule: customer-side changes). */
export const BELL_CHANGES = ['submitted', 'resubmitted', 'offer_accepted', 'offer_rejected', 'expired'] as const;
export type BellChange = (typeof BELL_CHANGES)[number];

/**
 * A request as people name it: its business id (`QR-000153`), or the first
 * eight characters of its id when it has none (matrix §2).
 */
export function quoteRequestNumber(rfq: Pick<QuoteRequest, 'id' | 'businessId'>): string {
  return rfq.businessId ? rfq.businessId : rfq.id.slice(0, 8);
}

const BELL_SENTENCES: Readonly<Record<BellChange, (number: string) => string>> = {
  submitted: (number) => `Quote request ${number} was submitted`,
  resubmitted: (number) => `Quote request ${number} was re-submitted`,
  offer_accepted: (number) => `The offer on quote request ${number} was accepted`,
  offer_rejected: (number) => `The offer on quote request ${number} was rejected`,
  expired: (number) => `Quote request ${number} expired`,
};

/**
 * What a bell entry about a request says (research R-11): the English sentence
 * and the address of its template in this module's bundle, with the number as
 * the one param. A bell is read outside the request's visibility, so it names
 * the request by number and nothing else — no Organization, no product, no
 * price.
 */
export function quoteRequestBellText(
  change: BellChange,
  number: string,
): { title: string; titleMessage: AdminNotificationMessage } {
  return {
    title: BELL_SENTENCES[change](number),
    titleMessage: { scope: 'quote_requests', key: `notifications.${change}.title`, params: { number } },
  };
}

/**
 * What the buyer's notification centre says about a change (matrix §2): one
 * sentence per change the matrix writes a centre entry for, read by the
 * customer side — so in the buyer's voice, where the bell's is the operator's.
 * The wording follows the change's customer e-mail subject.
 */
const CENTRE_SENTENCES: Readonly<Record<QuoteRequestNotificationChange, (number: string) => string>> = {
  submitted: (number) => `Quote request ${number} was submitted`,
  resubmitted: (number) => `Quote request ${number} was re-submitted`,
  offer_accepted: (number) => `The offer for quote request ${number} was accepted`,
  offer_rejected: (number) => `The offer for quote request ${number} was rejected`,
  expired: (number) => `Quote request ${number} has expired`,
  prepared: (number) => `We have prepared quote request ${number} for you`,
  revised: (number) => `Your offer for quote request ${number} is ready`,
  approved: (number) => `Quote request ${number} was approved`,
  canceled: (number) => `Quote request ${number} was canceled`,
};

/** The changes the centre has a sentence for — every one the matrix writes a `customer_in_app` record for. */
export const CENTRE_CHANGES = Object.keys(CENTRE_SENTENCES) as QuoteRequestNotificationChange[];

/**
 * What a centre entry about a request says (research R-13): the English
 * sentence and the address of its template in this module's bundle, with the
 * number as the one param — translated when the buyer reads it, in the
 * language they read it in. Number only, like the bell: no product, price or
 * Organization name travels into the centre (matrix §2).
 */
export function quoteRequestCentreText(
  change: QuoteRequestNotificationChange,
  number: string,
): { title: string; titleMessage: CustomerNotificationMessage } {
  return {
    title: CENTRE_SENTENCES[change](number),
    titleMessage: { scope: 'quote_requests', key: `customerNotifications.${change}.title`, params: { number } },
  };
}

/**
 * Where a request is on the storefront, storefront-relative and without a
 * locale prefix (the storefront localises it): the centre entry's link, and
 * the path the customer e-mail appends to the channel's storefront address.
 */
export function quoteRequestStorefrontLinkPath(rfqId: string): string {
  return `/quote-requests/${rfqId}`;
}

/** The push's title key in this module's bundle; the sentence is the body. */
export const PUSH_TITLE_KEY = 'customerPush.title';

/** Where a bell entry about a request leads: its admin screen. */
export function quoteRequestAdminLinkPath(rfqId: string): string {
  return `/quote-requests/${rfqId}`;
}

/** The e-mail a customer-side recipient is sent for `change` (matrix §3). */
export function customerEmailCode(change: QuoteRequestNotificationChange): string {
  return `quote_request_customer_${change}`;
}

/** The e-mail an operator is sent for `change` (matrix §3). */
export function operatorEmailCode(change: QuoteRequestNotificationChange): string {
  return `quote_request_operator_${change}`;
}

/**
 * `customerPushPort`'s answer as a closing status (`contracts/delivery-and-ports.md`
 * §3). A shop or channel with push or quote pushes switched off is the
 * operator's own switch, as a deactivated e-mail is: `skipped_deactivated`.
 */
export function pushOutcomeStatus(outcome: CustomerPushOutcome): DeliveryOutcome {
  switch (outcome) {
    case 'enqueued':
      return { status: 'sent' };
    case 'skipped:customer_preference':
      return { status: 'skipped_preference' };
    case 'skipped:no_account':
      return { status: 'skipped_no_recipient' };
    case 'skipped:no_subscription':
      return { status: 'skipped_no_subscription' };
    case 'skipped:switched_off':
      return { status: 'skipped_deactivated' };
  }
}

/**
 * The bundle a push is rendered from: the channel's default language reduced
 * to its primary subtag, bounded to the bundles the platform ships, English
 * otherwise. A push is rendered once, on the device, so it is sent as a
 * sentence (`specs/conventions/module-i18n.md`, translation-boundary case 1).
 */
export function pushLanguage(channelLanguage: string | null | undefined): SupportedLanguage {
  const primary = (channelLanguage ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary) ? (primary as SupportedLanguage) : LANGUAGE_FALLBACK;
}

/** The sender's answer as a closing status (matrix §4). A thrown send is a failed attempt, not an answer. */
export function emailOutcomeStatus(outcome: TransactionalSendOutcome): DeliveryOutcome {
  switch (outcome.status) {
    case 'sent':
      return { status: 'sent' };
    case 'logged':
      return { status: 'skipped_logged' };
    case 'deactivated':
      return { status: 'skipped_deactivated' };
    case 'no_transport':
      return { status: 'skipped_no_transport' };
    case 'no_definition':
      // A defect, not a state an operator chose: the manifest declares every code.
      return { status: 'failed', lastError: 'no_definition' };
  }
}

export interface ChannelAdapterDeps {
  adminUsers: Pick<AdminUserReadPort, 'findById'>;
  permissions: Pick<PermissionReadPort, 'listPermissions'>;
  customerAccounts: Pick<CustomerAccountReadPort, 'findById'>;
  /** The roles whose holders open every request of an Organization — the visibility rule, shared. */
  orgWideViewerRoleIds: OrgWideViewerRoleIds;
  organizations: Pick<OrganizationDetailsPort, 'findById'>;
  /** `admin_notifications`' record port; the bell entry is written on the record's transaction. */
  bell: AdminNotificationRecordPort<EntityManager>;
  /** `customer_notifications`' record port; the centre entry is written on the record's transaction. */
  centre: CustomerNotificationRecordPort<EntityManager>;
  /** `pwa`'s push port; it writes and enqueues the push itself, outside the record's transaction. */
  push: CustomerPushPort;
  /** This module's bundle, rendered in `language` — the push's title and sentence. */
  translate: (key: string, language: SupportedLanguage, params?: Record<string, string | number>) => Promise<string>;
  /** `transactional_emails`' late-bound sender, read per send; `undefined` until announced. */
  sender: () => TransactionalEmailSender | undefined;
  /**
   * The request's sales channel: its default language and its name; the system
   * default channel's language for a push about a request raised with none.
   */
  channels: Pick<SalesChannelResolutionPort, 'getById' | 'getSystemDefault'>;
  /** `sales_channels.storefront_url` of a channel, `null` when not configured. */
  storefrontUrl: (salesChannelId: string) => Promise<string | null>;
}

type SalesChannel = NonNullable<Awaited<ReturnType<SalesChannelResolutionPort['getById']>>>;

/** The channels delivered — every channel of the matrix. */
export type DeliveredChannel = QuoteRequestNotificationChannel;

function adminName(admin: AdminUserRecord): string {
  return `${admin.firstName} ${admin.lastName}`.trim() || admin.email;
}

function customerName(account: CustomerAccountRecord | null): string {
  if (!account) return '';
  return [account.firstName, account.lastName].filter(Boolean).join(' ').trim() || account.email;
}

/** An Admin UI language preference as an e-mail language: Polish for Polish, English for everything else. */
export function operatorEmailLanguage(preferredLanguage: string | null): 'en-US' | 'pl-PL' {
  const primary = preferredLanguage?.split('-', 1)[0]?.trim().toLowerCase();
  return primary === 'pl' ? 'pl-PL' : 'en-US';
}

/** A channel's name in `language`, falling back through its primary subtag and its default language. */
function channelName(channel: Pick<SalesChannel, 'name' | 'defaultLanguage' | 'code'>, language: string): string {
  const primary = language.split('-', 1)[0]?.toLowerCase();
  return (
    channel.name[language] ??
    Object.entries(channel.name).find(([tag]) => tag.split('-', 1)[0]?.toLowerCase() === primary)?.[1] ??
    channel.name[channel.defaultLanguage] ??
    Object.values(channel.name)[0] ??
    channel.code
  );
}

export function createChannelAdapters(deps: ChannelAdapterDeps): Record<DeliveredChannel, ChannelAdapter> {
  /** An administrator who may still be told: active, not deleted, holding `rfqs:handle`. */
  const handler = async (adminUserId: string): Promise<AdminUserRecord | null> => {
    const admin = await deps.adminUsers.findById(adminUserId);
    if (!admin || admin.status !== 'active' || admin.deletedAt !== null) return null;
    const held = await deps.permissions.listPermissions(admin.id);
    return held.includes('*') || held.includes(RFQ_HANDLE_PERMISSION) ? admin : null;
  };

  /** A customer who may still be told: live, a member of the request's Organization, and able to open it. */
  const viewer = async (rfq: QuoteRequest, customerAccountId: string): Promise<CustomerAccountRecord | null> => {
    const account = await deps.customerAccounts.findById(customerAccountId);
    if (!account || account.deletedAt !== null || account.blockedAt !== null || account.anonymizedAt !== null) return null;
    if (account.organizationId !== rfq.organizationId) return null;
    if (account.id !== rfq.customerAccountId) {
      const viewers = await deps.orgWideViewerRoleIds(rfq.organizationId);
      if (!viewers.includes(account.organizationRoleId)) return null;
    }
    return account;
  };

  /** The request's sales channel, `null` for a request raised with none or a channel that no longer resolves. */
  const channelOf = (rfq: QuoteRequest): Promise<SalesChannel | null> =>
    rfq.salesChannelId ? deps.channels.getById(rfq.salesChannelId) : Promise.resolve(null);

  /** The facts every e-mail names, in `language`. */
  const facts = async (context: DeliveryContext, channel: SalesChannel | null, language: string) => {
    const { em, rfq, sourceEvent } = context;
    const payload = sourceEvent.payload;
    const previousId = typeof payload['sourceRfqId'] === 'string' ? payload['sourceRfqId'] : null;
    const [organization, actor, previous, revision] = await Promise.all([
      deps.organizations.findById(rfq.organizationId),
      sourceEvent.actorCustomerAccountId
        ? deps.customerAccounts.findById(sourceEvent.actorCustomerAccountId)
        : Promise.resolve(null),
      previousId ? em.findOne(QuoteRequest, { id: previousId }) : Promise.resolve(null),
      sourceEvent.revisionId ? em.findOne(QuoteRequestRevision, { id: sourceEvent.revisionId }) : Promise.resolve(null),
    ]);
    return {
      organizationName: organization?.name ?? '',
      channelName: channel ? channelName(channel, language) : '',
      actorName: customerName(actor),
      previousNumber: previous ? quoteRequestNumber(previous) : '',
      revisionNumber: String(revision?.revisionNumber ?? rfq.currentRevisionNumber),
      reason: typeof payload['reason'] === 'string' ? payload['reason'] : '',
      validUntil: formatQuoteDate(rfq.expiresAt?.toISOString() ?? null, language),
    };
  };

  /**
   * Hand one message to the sender. The message id is the record's, so a retry
   * of a message the transport already accepted is suppressed (FR-014). A send
   * that raises is a failed attempt and is thrown — with the recipient's address
   * taken out of the error, which is stored on the record (data-model §1).
   */
  const send = async (
    context: DeliveryContext,
    message: { code: string; salesChannelId: string | null; language: string; to: string; variables: Record<string, unknown> },
  ): Promise<DeliveryOutcome> => {
    const sender = deps.sender();
    if (!sender) return { status: 'skipped_no_transport' };
    let outcome: TransactionalSendOutcome;
    try {
      outcome = await sender.send({
        code: message.code,
        salesChannelId: message.salesChannelId,
        language: message.language,
        to: message.to,
        messageId: `quote_request_notification:${context.record.id}`,
        document: { type: 'quote_request', id: context.rfq.id },
        variables: message.variables,
        meta: {
          kind: message.code,
          quoteRequestId: context.rfq.id,
          notificationId: context.record.id,
        },
      });
    } catch (error) {
      rethrowIfModuleDisabled(error);
      const text = error instanceof Error ? error.message : String(error);
      throw new Error(text.split(message.to).join('<recipient>'));
    }
    return emailOutcomeStatus(outcome);
  };

  return {
    admin_in_app: {
      owner: 'admin_notifications',
      async deliver({ em, record, rfq }) {
        const admin = await handler(record.recipientId);
        if (!admin) return { status: 'skipped_no_recipient' };
        if (!(BELL_CHANGES as readonly string[]).includes(record.change)) {
          throw new Error(`quote_requests: the bell does not ring for '${record.change}'`);
        }
        const text = quoteRequestBellText(record.change as BellChange, quoteRequestNumber(rfq));
        deps.bell.recordWithin(em, {
          audience: 'admin_user',
          targetAdminUserId: admin.id,
          kind: `quote_requests.${record.change}`,
          subjectType: 'quote_request',
          subjectId: rfq.id,
          title: text.title,
          titleMessage: text.titleMessage,
          linkPath: quoteRequestAdminLinkPath(rfq.id),
        });
        return { status: 'sent' };
      },
    },

    admin_email: {
      owner: 'transactional_emails',
      async deliver(context) {
        const admin = await handler(context.record.recipientId);
        if (!admin || !admin.email) return { status: 'skipped_no_recipient' };
        const language = operatorEmailLanguage(admin.preferredLanguage);
        const known = await facts(context, await channelOf(context.rfq), language);
        const lineCount = await context.em.count(QuoteRequestItem, { quoteRequestId: context.rfq.id });
        // An administrator is not a channel's customer: platform-wide content,
        // and no link until #185 (owner ruling OQ-1 = A).
        return send(context, {
          code: operatorEmailCode(context.record.change),
          salesChannelId: null,
          language,
          to: admin.email,
          variables: {
            quote: {
              number: quoteRequestNumber(context.rfq),
              lineCount: String(lineCount),
              previousNumber: known.previousNumber,
            },
            customer: { name: adminName(admin) },
            actor: { name: known.actorName },
            organization: { name: known.organizationName },
            channel: { name: known.channelName },
          },
        });
      },
    },

    customer_email: {
      owner: 'transactional_emails',
      async deliver(context) {
        const { rfq, record } = context;
        const account = await viewer(rfq, record.recipientId);
        if (!account || !account.email) return { status: 'skipped_no_recipient' };
        // The request's channel decides the language (FR-021); without one, English.
        const channel = await channelOf(rfq);
        const language = channel?.defaultLanguage || 'en-US';
        const known = await facts(context, channel, language);
        const base = channel ? (await deps.storefrontUrl(channel.id))?.trim().replace(/\/+$/, '') ?? '' : '';
        return send(context, {
          code: customerEmailCode(record.change),
          salesChannelId: rfq.salesChannelId ?? null,
          language,
          to: account.email,
          variables: {
            quote: {
              number: quoteRequestNumber(rfq),
              url: base ? `${base}${quoteRequestStorefrontLinkPath(rfq.id)}` : '',
              previousNumber: known.previousNumber,
              validUntil: known.validUntil,
              revisionNumber: known.revisionNumber,
            },
            customer: { name: customerName(account) },
            actor: { name: known.actorName },
            organization: { name: known.organizationName },
            channel: { name: known.channelName },
            reason: known.reason,
          },
        });
      },
    },

    customer_in_app: {
      owner: 'customer_notifications',
      async deliver({ em, record, rfq }) {
        // The same re-check as the e-mail's, minus the address: an entry needs none.
        const account = await viewer(rfq, record.recipientId);
        if (!account) return { status: 'skipped_no_recipient' };
        const text = quoteRequestCentreText(record.change, quoteRequestNumber(rfq));
        // One entry per record, on the record's transaction: it commits with the
        // record's closing, exactly once (FR-013). Addressed to one account of the
        // request's Organization (Principle XI) and shown on the request's own
        // channel only, or on every channel for a request raised with none
        // (Principle XII, FR-044).
        deps.centre.recordWithin(em, {
          organizationId: rfq.organizationId,
          customerAccountId: account.id,
          salesChannelId: rfq.salesChannelId ?? null,
          sourceModule: 'quote_requests',
          sourceKey: record.id,
          kind: `quote_requests.${record.change}`,
          subjectType: 'quote_request',
          subjectId: rfq.id,
          title: text.title,
          titleMessage: text.titleMessage,
          linkPath: quoteRequestStorefrontLinkPath(rfq.id),
        });
        return { status: 'sent' };
      },
    },

    customer_push: {
      owner: 'pwa',
      async deliver({ record, rfq }) {
        // The centre's re-check: a push needs no e-mail address either.
        const account = await viewer(rfq, record.recipientId);
        if (!account) return { status: 'skipped_no_recipient' };
        // The centre's sentence, rendered once in the channel's default language
        // (matrix §2): the device shows it as it is. A request raised with no
        // channel is pushed on the system default channel, so in its language.
        const channel = rfq.salesChannelId
          ? await deps.channels.getById(rfq.salesChannelId)
          : await deps.channels.getSystemDefault();
        const language = pushLanguage(channel?.defaultLanguage);
        const text = quoteRequestCentreText(record.change, quoteRequestNumber(rfq));
        const [title, body] = await Promise.all([
          deps.translate(PUSH_TITLE_KEY, language),
          deps.translate(text.titleMessage.key, language, text.titleMessage.params),
        ]);
        // Not on the record's transaction: `pwa` writes and enqueues on its own.
        // The record id is the push's idempotency key, so a retry after a crash
        // between the two commits writes no second push (FR-014). Gates `pwa`
        // owns — push and quote pushes on for the channel, the account's quote
        // preference, a subscribed device — come back as the outcome.
        const outcome = await deps.push.push({
          organizationId: rfq.organizationId,
          customerAccountId: account.id,
          salesChannelId: rfq.salesChannelId ?? null,
          category: 'quote',
          title,
          body,
          url: quoteRequestStorefrontLinkPath(rfq.id),
          sourceKey: record.id,
        });
        return pushOutcomeStatus(outcome);
      },
    },
  };
}
