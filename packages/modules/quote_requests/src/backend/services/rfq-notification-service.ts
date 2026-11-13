import type { EntityManager } from '@mikro-orm/postgresql';
import { QuoteRequestNotification } from '../entities/quote-request-notification.entity.js';
import type { QuoteRequestEvent } from '../entities/quote-request-event.entity.js';
import type { QuoteRequest } from '../entities/quote-request.entity.js';
import {
  NOTIFICATION_MATRIX,
  RECORDED_CHANNELS,
  channelSide,
  type NotificationRecipientKind,
  type QuoteRequestNotificationChange,
  type QuoteRequestNotificationChannel,
} from './notifications/notification-matrix.js';

/** The request fields the recording step reads. */
export type NotifiedQuoteRequest = Pick<
  QuoteRequest,
  'id' | 'organizationId' | 'customerAccountId' | 'assignedAdminUserId'
>;

/**
 * Who stands on each side of a request, resolved when the change commits
 * (`contracts/notification-matrix.md` rule 1). Each answers ids; duplicates are
 * removed by the caller.
 */
export interface NotificationRecipientResolver {
  /** `customer_accounts` ids: the requester and the members who may open the request. */
  customerSide(rfq: NotifiedQuoteRequest): Promise<readonly string[]>;
  /** `admin_users` ids: the operators told about a customer-side change. */
  operatorSide(rfq: NotifiedQuoteRequest): Promise<readonly string[]>;
}

export interface RecordNotificationsInput {
  change: QuoteRequestNotificationChange;
  /** The history entry this change wrote; the records name it (rule 5). */
  sourceEvent: Pick<QuoteRequestEvent, 'id' | 'eventType' | 'payload' | 'createdAt'>;
  rfq: NotifiedQuoteRequest;
  /** The customer account whose action caused the change, or `null` for an operator or the system. */
  actor: { customerAccountId: string } | null;
}

export interface PlannedNotification {
  recipientKind: NotificationRecipientKind;
  recipientId: string;
  channel: QuoteRequestNotificationChannel;
}

/**
 * The matrix row of `change` applied to resolved sides: one cell per
 * (recipient, channel), de-duplicated per channel, the actor removed where the
 * cell says `customer_except_actor`. Pure; `channels` limits the result.
 */
export function plannedNotifications(
  change: QuoteRequestNotificationChange,
  sides: { customer: readonly string[]; operator: readonly string[] },
  actorCustomerAccountId: string | null,
  channels: readonly QuoteRequestNotificationChannel[] = RECORDED_CHANNELS,
): PlannedNotification[] {
  const row = NOTIFICATION_MATRIX[change];
  const planned: PlannedNotification[] = [];
  for (const channel of channels) {
    const audience = row.channels[channel];
    if (audience === null) continue;
    const ids = audience === 'operator' ? sides.operator : sides.customer;
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (audience === 'customer_except_actor' && id === actorCustomerAccountId) continue;
      planned.push({ recipientKind: channelSide(channel), recipientId: id, channel });
    }
  }
  return planned;
}

/**
 * Records who is to be told about a quote request change —
 * `specs/179-rfq-and-customer-notifications/` FR-001 – FR-007. One
 * `quote_request_notifications` row per matrix cell, `pending`, for the
 * delivery worker to close.
 *
 * There is **no path of its own**: the rows are persisted into the caller's
 * EntityManager and commit or roll back with the change they announce. A
 * unique violation is not absorbed — a caller names a history entry it has
 * just written, which no earlier attempt can have used.
 */
export class RfqNotificationService {
  constructor(private readonly recipients: NotificationRecipientResolver) {}

  /** Returns the number of records written. */
  async record(within: EntityManager, input: RecordNotificationsInput): Promise<number> {
    // command-coverage-ignore: notification delivery bookkeeping — per-recipient
    // delivery records written in the transaction of the audited transition they
    // announce, not an audited domain-state mutation of their own (research R-19).
    assertSourceEvent(input.change, input.sourceEvent);
    const row = NOTIFICATION_MATRIX[input.change];
    const audiences = new Set(RECORDED_CHANNELS.map((channel) => row.channels[channel]));
    const customer =
      audiences.has('customer') || audiences.has('customer_except_actor')
        ? await this.recipients.customerSide(input.rfq)
        : [];
    const operator = audiences.has('operator') ? await this.recipients.operatorSide(input.rfq) : [];
    const planned = plannedNotifications(
      input.change,
      { customer, operator },
      input.actor?.customerAccountId ?? null,
    );
    if (planned.length === 0) return 0;
    for (const cell of planned) {
      within.persist(
        within.create(QuoteRequestNotification, {
          organizationId: input.rfq.organizationId,
          quoteRequestId: input.rfq.id,
          sourceEventId: input.sourceEvent.id,
          change: input.change,
          recipientKind: cell.recipientKind,
          recipientId: cell.recipientId,
          channel: cell.channel,
          status: 'pending',
          attempts: 0,
          lastError: null,
          closedAt: null,
          sourceOccurredAt: input.sourceEvent.createdAt,
        }),
      );
    }
    await within.flush();
    return planned.length;
  }
}

/** A caller naming the wrong history entry is a programming error, refused before anything is written. */
function assertSourceEvent(
  change: QuoteRequestNotificationChange,
  sourceEvent: RecordNotificationsInput['sourceEvent'],
): void {
  const row = NOTIFICATION_MATRIX[change];
  if (sourceEvent.eventType !== row.sourceEventType) {
    throw new Error(
      `quote request notification '${change}' announces a '${row.sourceEventType}' history entry, not '${sourceEvent.eventType}'`,
    );
  }
  for (const [field, value] of Object.entries(row.sourceDiscriminator ?? {})) {
    if (sourceEvent.payload[field] !== value) {
      throw new Error(
        `quote request notification '${change}' announces a '${row.sourceEventType}' entry with ${field} '${value}', not '${String(sourceEvent.payload[field])}'`,
      );
    }
  }
}
