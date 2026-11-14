import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { QuoteRequest } from '../../entities/quote-request.entity.js';
import { QuoteRequestEvent } from '../../entities/quote-request-event.entity.js';
import {
  QuoteRequestNotification,
  type QuoteRequestNotificationStatus,
} from '../../entities/quote-request-notification.entity.js';
import { anyRowExists, type WorkRows } from '../scheduled-work-probe.js';
import type { QuoteRequestNotificationChannel } from './notification-matrix.js';

/**
 * Delivery of quote request notification records —
 * `specs/179-rfq-and-customer-notifications/` FR-010 – FR-016, research R-8,
 * `contracts/delivery-and-ports.md` §3.
 *
 * **The table is the queue.** A pass reads the `pending` records that are due,
 * oldest first and at most {@link RFQ_NOTIFICATION_BATCH_SIZE} of them, and
 * takes each in a transaction of its own, locked `for update skip locked`: two
 * worker processes passing at once split the records rather than queue, and
 * neither delivers one the other holds. Under the lock the record is re-read
 * with the pass's own predicate, so a record another pass closed in the
 * meantime is left alone. A closed record never changes again.
 *
 * **What one record goes through, in this order:**
 *
 *  1. **Fresh?** A change more than {@link RFQ_NOTIFICATION_FRESHNESS_MS} old
 *     when the pass reaches it closes `skipped_stale` and nothing is sent
 *     (FR-011, owner ruling Q8): "your quote was approved" a week late is
 *     noise, and to a buyer it reads as a fault.
 *  2. **Is the channel's owner present?** Decided in front of its port, never
 *     by catching behind it (D-60): an owner that is off closes the record
 *     `skipped_module_off` without an attempt (FR-012).
 *  3. **Deliver** through the channel's adapter, inside the record's
 *     transaction — so the bell or centre entry an adapter writes with
 *     `recordWithin` commits with the record's closing, exactly once
 *     (FR-013), and an e-mail is handed over with the record's id as its
 *     message id (FR-014).
 *
 * **A failed attempt rolls its transaction back** — whatever the adapter had
 * written goes with it — and is then counted in a transaction of its own: the
 * attempt number, the error (truncated, and never carrying a recipient's
 * address, which the adapters scrub) and the next attempt's time, backed off by
 * {@link RFQ_NOTIFICATION_RETRY_LADDER_MS}. The fifth failure closes the record
 * `failed` (FR-015). That second write is guarded by the attempt count it
 * read, so a pass that lost the record in between changes nothing.
 *
 * A `ModuleDisabledError` raised by an owner's port despite step 2 — the flip
 * landed between the question and the call — closes the record
 * `skipped_module_off`: the owner's answer arrived late, and it is the same
 * answer. One for `quote_requests` itself is re-thrown and fails the pass,
 * which the worker gate then holds (module-composition item 7).
 *
 * **Only channels with an adapter are claimed.** Every channel of the matrix
 * has one since WP-10; a channel added without one would not be read, counted
 * or closed by this pass.
 *
 * A push is the one delivery not written on the record's transaction: `pwa`
 * writes and enqueues it through `customerPushPort` on its own, keyed by the
 * record id, so a retry after a crash between the two commits is answered
 * `enqueued` and writes nothing (FR-014).
 *
 * The pass runs in the system scope the worker opens; the probe
 * ({@link RfqNotificationDeliveryService.hasDeliverable}) runs outside it and
 * learns one bit (issue #120).
 */

/** The most records one pass takes. The next tick — or kick — takes the rest. */
export const RFQ_NOTIFICATION_BATCH_SIZE = 200;

/** How old a change may be and still be told about (FR-011, owner ruling Q8). */
export const RFQ_NOTIFICATION_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/** How many attempts a record gets before it closes `failed` (FR-015). */
export const RFQ_NOTIFICATION_MAX_ATTEMPTS = 5;

/** The wait after failed attempt 1, 2, 3 and 4: 1 min, 5 min, 30 min, 2 h. */
export const RFQ_NOTIFICATION_RETRY_LADDER_MS: readonly number[] = [
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
];

/** The longest `last_error` kept (data-model §1). */
export const RFQ_NOTIFICATION_LAST_ERROR_MAX = 2000;

export type ClosingStatus = Exclude<QuoteRequestNotificationStatus, 'pending'>;

/** How an adapter closes a record. `lastError` only with `failed`. */
export type DeliveryOutcome = { status: ClosingStatus; lastError?: string };

/** What an adapter is handed: the record, what it announces, and the record's own transaction. */
export interface DeliveryContext {
  /** The record's transaction. Anything written on it commits with the record's closing. */
  em: EntityManager;
  record: QuoteRequestNotification;
  rfq: QuoteRequest;
  /** The history entry the record announces. */
  sourceEvent: QuoteRequestEvent;
}

/** One channel's delivery. */
export interface ChannelAdapter {
  /** The module whose presence decides whether this channel delivers at all. */
  readonly owner: string;
  /**
   * Deliver one record. Answers how it closes; throws for a failed attempt
   * (retried), and passes a `ModuleDisabledError` on as it is.
   */
  deliver(context: DeliveryContext): Promise<DeliveryOutcome>;
}

export interface RfqNotificationDeliveryDeps {
  emFactory: () => EntityManager;
  /** The channels this phase delivers. A channel without one is not claimed. */
  adapters: Partial<Record<QuoteRequestNotificationChannel, ChannelAdapter>>;
  /** `effectiveState.isPresent`. */
  isPresent: (moduleId: string) => boolean;
  /** Where a failed attempt is reported. */
  log?: (message: string, context: Record<string, unknown>) => void;
  /** Defaults to {@link RFQ_NOTIFICATION_BATCH_SIZE}. */
  batchSize?: number;
}

/** What one pass did. */
export interface RfqNotificationDeliveryResult {
  /** Records this pass held the lock of. */
  claimed: number;
  /** Of them, closed — sent, skipped or failed. */
  closed: number;
  /** Of them, a failed attempt left pending for a later one. */
  retried: number;
  /** Whether the pass stopped at its bound, so more may be due. */
  reachedBatchLimit: boolean;
}

type AttemptResult = 'lost' | 'closed' | 'retried';

export class RfqNotificationDeliveryService {
  constructor(private readonly deps: RfqNotificationDeliveryDeps) {}

  /** The channels a pass claims: those it has an adapter for. */
  get channels(): QuoteRequestNotificationChannel[] {
    return (Object.keys(this.deps.adapters) as QuoteRequestNotificationChannel[]).filter(
      (channel) => this.deps.adapters[channel] !== undefined,
    );
  }

  /**
   * The records due at `now` — **the one statement of it**, read by the probe
   * to ask, by the pass to list and by each attempt to re-check under its lock.
   */
  dueRecords(now: Date): WorkRows {
    const channels = this.channels;
    return {
      from:
        `from "quote_request_notifications" n where n."status" = 'pending' and n."next_attempt_at" <= ?` +
        (channels.length > 0 ? ` and n."channel" in (${channels.map(() => '?').join(', ')})` : ' and false'),
      params: [now, ...channels],
    };
  }

  /**
   * Whether a pass at `now` would find anything — **yes or no, and nothing
   * else**. Asked outside any tenant scope, before the worker opens one.
   */
  async hasDeliverable(now: Date = new Date()): Promise<boolean> {
    return anyRowExists(this.deps.emFactory(), [this.dueRecords(now)]);
  }

  /** One pass, for a caller that has already entered a system scope — the worker. */
  async deliverInScope(now: Date = new Date()): Promise<RfqNotificationDeliveryResult> {
    const batchSize = this.deps.batchSize ?? RFQ_NOTIFICATION_BATCH_SIZE;
    const rows = this.dueRecords(now);
    const due = await this.deps
      .emFactory()
      .execute<Array<{ id: string }>>(
        `select n."id" ${rows.from} order by n."created_at" asc, n."id" asc limit ?`,
        [...rows.params, batchSize],
      );
    const result: RfqNotificationDeliveryResult = {
      claimed: 0,
      closed: 0,
      retried: 0,
      reachedBatchLimit: due.length === batchSize,
    };
    for (const { id } of due) {
      const attempt = await this.#attempt(id, now);
      if (attempt === 'lost') continue;
      result.claimed += 1;
      if (attempt === 'closed') result.closed += 1;
      else result.retried += 1;
    }
    return result;
  }

  /** One record, in a transaction of its own. */
  async #attempt(id: string, now: Date): Promise<AttemptResult> {
    let seenAttempts: number | null = null;
    try {
      return await this.deps.emFactory().transactional(async (em) => {
        // command-coverage-ignore: notification delivery bookkeeping — closing a
        // delivery record of an audited transition, not a domain write of its
        // own (research R-19).
        const rows = this.dueRecords(now);
        const locked = await em.execute<Array<{ id: string }>>(
          `select n."id" ${rows.from} and n."id" = ? for update skip locked`,
          [...rows.params, id],
        );
        if (locked.length === 0) return 'lost';
        const record = await em.findOne(QuoteRequestNotification, { id });
        if (!record || record.status !== 'pending') return 'lost';
        seenAttempts = record.attempts;
        const { outcome, attempted } = await this.#decide(em, record, now);
        if (attempted) record.attempts = seenAttempts + 1;
        close(record, outcome, now);
        await em.flush();
        return 'closed';
      });
    } catch (error) {
      if (error instanceof ModuleDisabledError && error.moduleId === 'quote_requests') throw error;
      if (seenAttempts === null) {
        // Nothing was read: the claim itself failed. The record is as it was and
        // the next pass reaches it.
        this.#report('quote_requests: claiming a notification record failed; the next pass retries', id, error);
        return 'lost';
      }
      const outcome: DeliveryOutcome | null =
        error instanceof ModuleDisabledError ? { status: 'skipped_module_off' } : null;
      return this.#countFailedAttempt(id, seenAttempts, outcome, error, now);
    }
  }

  /** Steps 1 – 3 of the file header, for a record held under its lock. */
  async #decide(
    em: EntityManager,
    record: QuoteRequestNotification,
    now: Date,
  ): Promise<{ outcome: DeliveryOutcome; attempted: boolean }> {
    if (now.getTime() - record.sourceOccurredAt.getTime() > RFQ_NOTIFICATION_FRESHNESS_MS) {
      return { outcome: { status: 'skipped_stale' }, attempted: false };
    }
    const adapter = this.deps.adapters[record.channel];
    if (!adapter) throw new Error(`quote_requests: no delivery for channel '${record.channel}'`);
    if (!this.deps.isPresent(adapter.owner)) return { outcome: { status: 'skipped_module_off' }, attempted: false };

    const [rfq, sourceEvent] = await Promise.all([
      em.findOne(QuoteRequest, { id: record.quoteRequestId }),
      em.findOne(QuoteRequestEvent, { id: record.sourceEventId }),
    ]);
    // Both cascade on delete with the record, so neither can be gone while it is held.
    if (!rfq || !sourceEvent) throw new Error('quote_requests: a notification record outlived what it announces');
    return { outcome: await adapter.deliver({ em, record, rfq, sourceEvent }), attempted: true };
  }

  /**
   * A failed attempt, counted in a transaction of its own after the attempt's
   * rolled back. `closing` is set when the failure is itself a closing (an
   * owner switched off under the call).
   */
  async #countFailedAttempt(
    id: string,
    seenAttempts: number,
    closing: DeliveryOutcome | null,
    error: unknown,
    now: Date,
  ): Promise<AttemptResult> {
    const message = truncate(error instanceof Error ? error.message : String(error));
    if (closing === null) this.#report('quote_requests: delivering a notification failed', id, error);
    return this.deps.emFactory().transactional(async (em) => {
      // command-coverage-ignore: notification delivery bookkeeping (research R-19).
      const record = await em.findOne(QuoteRequestNotification, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      // Another pass took it between the two transactions: its answer stands.
      if (!record || record.status !== 'pending' || record.attempts !== seenAttempts) return 'lost';
      record.attempts = seenAttempts + 1;
      if (closing !== null) {
        close(record, closing, now);
      } else if (record.attempts >= RFQ_NOTIFICATION_MAX_ATTEMPTS) {
        close(record, { status: 'failed', lastError: message }, now);
      } else {
        record.lastError = message;
        record.nextAttemptAt = new Date(now.getTime() + RFQ_NOTIFICATION_RETRY_LADDER_MS[record.attempts - 1]!);
      }
      await em.flush();
      return record.status === 'pending' ? 'retried' : 'closed';
    });
  }

  #report(message: string, id: string, error: unknown): void {
    const context = { notificationId: id, error: error instanceof Error ? error.message : String(error) };
    if (this.deps.log) this.deps.log(message, context);
    else console.warn(JSON.stringify({ level: 'warn', msg: message, ...context }));
  }
}

function close(record: QuoteRequestNotification, outcome: DeliveryOutcome, now: Date): void {
  record.status = outcome.status;
  record.closedAt = now;
  // A closing other than `failed` leaves no error behind; `failed` keeps the one that closed it.
  if (outcome.lastError !== undefined) record.lastError = truncate(outcome.lastError);
  else if (outcome.status !== 'failed') record.lastError = null;
}

function truncate(message: string): string {
  return message.length > RFQ_NOTIFICATION_LAST_ERROR_MAX ? message.slice(0, RFQ_NOTIFICATION_LAST_ERROR_MAX) : message;
}
