import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminNotificationMessage,
  AdminNotificationRecordPort,
  AdminUserReadPort,
  AdminUserRecord,
  CustomerAccountReadPort,
  CustomerAccountRecord,
  OrganizationDetailsPort,
  PermissionReadPort,
  TransactionalEmailSender,
  TransactionalSendOutcome,
} from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled, type SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import { formatQuoteDate } from '../../document/blocks/types.js';
import { QuoteRequest } from '../../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../../entities/quote-request-item.entity.js';
import { QuoteRequestRevision } from '../../entities/quote-request-revision.entity.js';
import type { ChannelAdapter, DeliveryContext, DeliveryOutcome } from './delivery-service.js';
import type { QuoteRequestNotificationChange, QuoteRequestNotificationChannel } from './notification-matrix.js';
import { RFQ_HANDLE_PERMISSION, type OrgWideViewerRoleIds } from './recipients.js';

/**
 * The three channels of `specs/179-rfq-and-customer-notifications/` Phase 1 —
 * the admin bell, the operator e-mail and the customer e-mail
 * (`contracts/notification-matrix.md` §2 – §4, `contracts/delivery-and-ports.md` §3).
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
  /** `transactional_emails`' late-bound sender, read per send; `undefined` until announced. */
  sender: () => TransactionalEmailSender | undefined;
  /** The request's sales channel: its default language and its name. */
  channels: Pick<SalesChannelResolutionPort, 'getById'>;
  /** `sales_channels.storefront_url` of a channel, `null` when not configured. */
  storefrontUrl: (salesChannelId: string) => Promise<string | null>;
}

type SalesChannel = NonNullable<Awaited<ReturnType<SalesChannelResolutionPort['getById']>>>;

export type Phase1Channel = Extract<QuoteRequestNotificationChannel, 'admin_in_app' | 'admin_email' | 'customer_email'>;

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

export function createChannelAdapters(deps: ChannelAdapterDeps): Record<Phase1Channel, ChannelAdapter> {
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
              url: base ? `${base}/quote-requests/${rfq.id}` : '',
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
  };
}
