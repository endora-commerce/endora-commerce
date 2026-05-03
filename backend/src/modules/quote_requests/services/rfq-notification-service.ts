import type { EntityManager } from '@mikro-orm/postgresql';
import {
  QuoteRequestNotificationEvent,
  type QuoteRequestNotificationChannel,
} from '../entities/quote-request-notification-event.entity.js';

/**
 * Notification fan-out for Quote Request lifecycle transitions.
 *
 * The unique index on
 * (quote_request_id, source_event_id, recipient*, channel) is enforced
 * at the DB level (migration 029); duplicate-row attempts are caught
 * here as Postgres `23505` and silently ignored, keeping retries
 * idempotent (FR-030 + research §R4).
 *
 * Actual transport (email send, in-app surface push) is handled by the
 * foundation `notifications` BullMQ queue — out of scope for this
 * service. We only persist the row and mark it `queued`; the queue
 * worker flips it to `sent` / `failed`.
 */
export interface NotificationRecipient {
  adminUserId?: string | null;
  customerAccountId?: string | null;
}

export interface EnqueueNotificationInput {
  quoteRequestId: string;
  sourceEventId: string;
  recipients: NotificationRecipient[];
  channels: QuoteRequestNotificationChannel[];
}

export class RfqNotificationService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Persist one row per recipient × channel. Returns the number of
   * rows actually inserted (after dedupe).
   */
  async enqueue(input: EnqueueNotificationInput): Promise<number> {
    const em = this.emFactory();
    let inserted = 0;
    for (const recipient of input.recipients) {
      // Skip empty recipient (would violate the actor-XOR invariant if both
      // adminUserId and customerAccountId are null).
      if (!recipient.adminUserId && !recipient.customerAccountId) continue;

      for (const channel of input.channels) {
        const event = em.create(QuoteRequestNotificationEvent, {
          quoteRequestId: input.quoteRequestId,
          sourceEventId: input.sourceEventId,
          recipientAdminUserId: recipient.adminUserId ?? null,
          recipientCustomerAccountId: recipient.customerAccountId ?? null,
          channel,
          status: 'queued',
        });
        try {
          await em.persistAndFlush(event);
          inserted += 1;
        } catch (err: unknown) {
          // Postgres unique-violation on (rfq, event, recipient, channel) —
          // this is the dedupe guarantee firing on a retry.
          em.clear();
          if (!isUniqueViolation(err)) throw err;
        }
      }
    }
    return inserted;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { code?: unknown };
  return candidate.code === '23505';
}
