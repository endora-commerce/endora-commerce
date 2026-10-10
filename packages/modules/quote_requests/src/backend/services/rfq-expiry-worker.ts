import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminUserReadPort, SalesRepAssignmentPort } from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import type { RfqEventBus } from './rfq-service.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqNotificationService, NotificationRecipient } from './rfq-notification-service.js';
import { anyRowExists, type WorkRows } from './scheduled-work-probe.js';

/**
 * RfqExpiryWorker — the sweep that moves Pending and Created from admin Quote
 * Requests past the configured expiry to `Expired`, writes the `expired`
 * history row, queues the notifications and announces `rfq.expired.v1`
 * (FR-030).
 *
 * `quote_requests.expiry_days = 0` disables it entirely. Otherwise a request is
 * due when all three hold — {@link RfqExpiryWorker.dueRequests} is the one
 * statement of them, read by the probe to ask and by the pass to act:
 *
 *  1. **It is still open**: `Pending` or `Created from admin`. Both are named
 *     by the setting, and between them they cover a request waiting for the
 *     seller's first answer and an offer waiting for the buyer.
 *  2. **Nothing has happened to it for `expiry_days`.** The clock is the
 *     request's latest history row (`quote_request_events`), not the row's
 *     `updated_at`: a submission, an edit, a revision and a note each write
 *     one, so each restarts the clock, while a write that says nothing to
 *     anybody — the buyer merely opening the request, which marks the revision
 *     as seen; an assignment — does not.
 *  3. **It carries no live offer.** A seller who dated an offer (`expiresAt`)
 *     told the buyer how long they have, and that promise outranks this
 *     module's inactivity default: a request whose `expiresAt` is still in the
 *     future is never expired here, however long it has been quiet. Once the
 *     date has passed, or where none was set, the inactivity rule applies as
 *     to any other request. This sweep does **not** expire a request *because*
 *     its `expiresAt` passed — that date is enforced where the buyer accepts
 *     or converts, and whether it should also close the request is not this
 *     sweep's to decide.
 *
 * ## One Quote Request, one unit of work
 *
 * The pass used to flush **every** due row to `Expired` in one statement and
 * then loop over them, writing each one's history row, notifications and event.
 * A throw on the second of three left three rows `Expired`, one announced, and
 * nothing for the next pass to find: the other two were expired silently and
 * for good.
 *
 * Each request is now its own transaction — the status change, the history row
 * and the notification rows commit together or not at all — and its event is
 * emitted once that transaction has returned. A request that fails stays as it
 * was and is due again on the next pass; the others in the batch are not
 * affected by it.
 *
 * ## A bounded pass
 *
 * A pass takes at most {@link RFQ_EXPIRY_BATCH_SIZE} requests, oldest first,
 * and says whether it stopped at the bound. An instance that has never run
 * this sweep can hold years of due requests; they are worked off a batch per
 * tick, with no transaction longer than one request and no more than a batch
 * of events at once. A request that fails is left alone by this process for
 * {@link RFQ_EXPIRY_RETRY_AFTER_MS}, so a block of requests that fail every
 * time cannot be the head of every batch.
 *
 * ## Late news is not sent
 *
 * A request that became due long before this pass reached it — the backlog of
 * an instance where the sweep was not running, or the far end of a long outage
 * — is expired, gets its history row and is announced on the event bus like any
 * other: the state has to become true. What it does **not** get is the
 * notification rows, for anybody: "your quote request has expired" months
 * after the fact is noise, and to a customer it reads as a fault. The bound is
 * {@link RFQ_EXPIRY_NOTIFICATION_GRACE_MS} past the moment the request became
 * due.
 *
 * `sweep()` is a plain async function, so a test can drive it without Redis.
 */

/** How many Quote Requests one pass expires at most. */
export const RFQ_EXPIRY_BATCH_SIZE = 500;

/**
 * How long after a Quote Request became due its expiry is still worth telling
 * people about. A day: it covers a worker that was down overnight, and nothing
 * longer than that is news.
 */
export const RFQ_EXPIRY_NOTIFICATION_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * How long a request whose unit of work failed is left alone by this process
 * before it is tried again. Without it a block of requests that fail every
 * time would be the head of every batch — oldest first, bounded — and nothing
 * younger would ever be reached. Two hours: four ticks for the others to pass.
 * Held in memory, per process: a restart forgets it, which costs one retry.
 */
export const RFQ_EXPIRY_RETRY_AFTER_MS = 2 * 60 * 60 * 1000;

/** No more failed requests than this are remembered; beyond it the oldest are forgotten. */
const BACK_OFF_LIMIT = 1_000;

const DAY_MS = 86_400_000;

/**
 * When something last happened to a request: its latest history row, or its
 * creation for a request that has none.
 */
const LAST_ACTIVITY = `coalesce((select max(e."created_at") from "quote_request_events" e where e."quote_request_id" = q."id"), q."created_at")`;

/** The statuses a Quote Request can expire from. */
const EXPIRABLE_STATUSES = ['Pending', 'Created from admin'] as const;

declare module './rfq-service.js' {
  interface RfqEvents {
    'rfq.expired.v1': import('@endora-commerce/platform/events').EventBase & {
      rfqId: string;
      /** The Organization the Quote Request belongs to — this sweep crosses all of them. */
      organizationId: string;
    };
  }
}

export interface RfqExpiryWorkerDeps {
  emFactory: () => EntityManager;
  events: RfqEventBus;
  eventService: RfqEventService;
  notificationService: RfqNotificationService;
  salesRepAssignment: SalesRepAssignmentPort;
  /**
   * Feature 075, Phase C — the unassigned-organisation fan-out. It was
   * `em.find(AdminUser, {})` against `admin_users`' table; `listAll` is the
   * read that module published for exactly this, and its doc comment says so.
   */
  adminUsers: AdminUserReadPort;
  /** Resolves the current `quote_requests.expiry_days` from settings. */
  resolveExpiryDays: () => Promise<number>;
  /** At most this many requests per pass. Defaults to {@link RFQ_EXPIRY_BATCH_SIZE}. */
  batchSize?: number;
  /** Defaults to {@link RFQ_EXPIRY_NOTIFICATION_GRACE_MS}. */
  notificationGraceMs?: number;
  /** Defaults to {@link RFQ_EXPIRY_RETRY_AFTER_MS}. */
  retryAfterMs?: number;
  /** Told about a request whose unit of work failed; it stays due. Defaults to a warning on the console. */
  onRequestFailed?: (rfqId: string, error: unknown) => void;
}

/** What one pass did. */
export interface RfqExpirySweepResult {
  /** Requests moved to `Expired` by this pass. */
  expiredCount: number;
  /** Requests whose unit of work failed; they are still due. */
  failedCount: number;
  /** Of the expired, how many were too late to notify anybody about. */
  notificationsSuppressedCount: number;
  /** Whether the pass stopped at its bound, so more may be due. */
  reachedBatchLimit: boolean;
}

const NOTHING: RfqExpirySweepResult = {
  expiredCount: 0,
  failedCount: 0,
  notificationsSuppressedCount: 0,
  reachedBatchLimit: false,
};

function reportFailure(rfqId: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'quote_requests: expiring a quote request failed; it stays due for the next sweep',
      rfqId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

export class RfqExpiryWorker {
  constructor(private readonly deps: RfqExpiryWorkerDeps) {}

  /**
   * Whether a {@link sweep} at `now` would find anything to expire — **yes or
   * no, and nothing else**.
   *
   * The scheduled consumer asks this before it opens its system scope, so that
   * a tick with nothing to do writes no `tenant.escape_hatch` audit row. It is
   * the one statement of this class that runs with no tenant context, and it
   * stays legitimate by learning one bit: it goes through `anyRowExists`, which
   * writes the select list itself and returns a boolean, so no row, id or count
   * of any Organization leaves it. The setting it reads first is platform
   * configuration, not an Organization's data. Its answer is never handed to
   * the pass, which re-reads everything inside the scope.
   */
  async hasExpirable(now: Date = new Date()): Promise<boolean> {
    const expiryDays = await this.deps.resolveExpiryDays();
    if (!Number.isFinite(expiryDays) || expiryDays <= 0) return false;
    return anyRowExists(this.deps.emFactory(), [this.dueRequests(now, expiryDays)]);
  }

  /**
   * The requests a pass at `now` would expire, as a row source — **the one
   * statement of the rule**, read by {@link hasExpirable} to ask, by the pass
   * to list and by each unit of work to re-check under its lock. A condition
   * added here is added to all three by the same edit, so the question cannot
   * drift from the pass. The three conditions are the ones the file header
   * gives; the fourth leaves out what this process is backing off from.
   */
  dueRequests(now: Date, expiryDays: number): WorkRows {
    const backingOff = this.#backingOff(now);
    return {
      from:
        `from "quote_requests" q` +
        ` where q."status" in (${EXPIRABLE_STATUSES.map(() => '?').join(', ')})` +
        ` and ${LAST_ACTIVITY} < ?` +
        ` and (q."expires_at" is null or q."expires_at" <= ?)` +
        (backingOff.length > 0 ? ` and q."id" not in (${backingOff.map(() => '?').join(', ')})` : ''),
      params: [...EXPIRABLE_STATUSES, new Date(now.getTime() - expiryDays * DAY_MS), now, ...backingOff],
    };
  }

  /** Request id → when this process may try it again. */
  readonly #retryAt = new Map<string, number>();

  /** The requests that failed recently enough to be left alone at `now`. */
  #backingOff(now: Date): string[] {
    for (const [id, retryAt] of this.#retryAt) {
      if (retryAt <= now.getTime()) this.#retryAt.delete(id);
    }
    return [...this.#retryAt.keys()];
  }

  #backOff(id: string, now: Date): void {
    this.#retryAt.set(id, now.getTime() + (this.deps.retryAfterMs ?? RFQ_EXPIRY_RETRY_AFTER_MS));
    // A Map keeps insertion order, so the first key is the oldest failure.
    while (this.#retryAt.size > BACK_OFF_LIMIT) {
      this.#retryAt.delete(this.#retryAt.keys().next().value as string);
    }
  }

  /** One pass, under a system scope of its own — for a caller that has none. */
  async sweep(now: Date = new Date()): Promise<RfqExpirySweepResult> {
    // Feature 050 — system-wide sweep across all orgs; run under a system scope
    // so the QuoteRequest reads/writes carry a tenant context (fail-closed guard).
    return withSystemScope('rfq-expiry sweep', () => this.sweepInScope(now));
  }

  /**
   * One pass, for a caller that has already entered a system scope — the
   * scheduled consumer, which enters it as the queue's entry point. Entering a
   * second one here would write a second escape-hatch audit row per tick.
   */
  async sweepInScope(now: Date = new Date()): Promise<RfqExpirySweepResult> {
    const expiryDays = await this.deps.resolveExpiryDays();
    if (!Number.isFinite(expiryDays) || expiryDays <= 0) return NOTHING;

    const batchSize = this.deps.batchSize ?? RFQ_EXPIRY_BATCH_SIZE;
    const rows = this.dueRequests(now, expiryDays);
    const due = await this.deps
      .emFactory()
      .execute<Array<{ id: string }>>(
        `select q."id" ${rows.from} order by ${LAST_ACTIVITY} asc, q."id" asc limit ?`,
        [...rows.params, batchSize],
      );

    let expiredCount = 0;
    let failedCount = 0;
    let notificationsSuppressedCount = 0;
    for (const { id } of due) {
      try {
        const outcome = await this.#expireOne(id, { now, expiryDays });
        if (outcome === null) continue;
        expiredCount += 1;
        if (!outcome.notified) notificationsSuppressedCount += 1;
      } catch (error) {
        // A module switched off underneath the pass is never absorbed
        // (module-composition item 7): every other request would fail the same
        // way, and the pass stops here with all of them still due.
        rethrowIfModuleDisabled(error);
        failedCount += 1;
        this.#backOff(id, now);
        (this.deps.onRequestFailed ?? reportFailure)(id, error);
      }
    }
    return {
      expiredCount,
      failedCount,
      notificationsSuppressedCount,
      reachedBatchLimit: due.length === batchSize,
    };
  }

  /**
   * Expire one Quote Request as one unit of work, and announce it once that
   * unit has committed. Answers `null` when the request is no longer due —
   * somebody answered it, or another consumer holds it — and throws when the
   * unit failed, in which case nothing of it was written and nothing announced.
   */
  async #expireOne(
    id: string,
    pass: { now: Date; expiryDays: number },
  ): Promise<{ notified: boolean } | null> {
    // command-coverage-ignore: background expiry sweep — flips an overdue RFQ to
    // Expired on a timer, a system lifecycle job, not an operator-initiated write.
    const graceMs = this.deps.notificationGraceMs ?? RFQ_EXPIRY_NOTIFICATION_GRACE_MS;
    const expired = await this.deps.emFactory().transactional(async (em) => {
      // Re-check under a lock, with the pass's own predicate: the id list was
      // read before this transaction began, and since then the buyer may have
      // answered, the seller may have revised or dated an offer, or another
      // consumer may have expired it. `skip locked` does two jobs: two
      // consumers sweeping at once split the requests rather than queue, and a
      // transition that holds the row (`underRowLock`) is left to finish —
      // this pass skips the request and the next one finds it as it then is.
      const rows = this.dueRequests(pass.now, pass.expiryDays);
      const locked = await em.execute<Array<{ last_activity_at: Date | string }>>(
        `select ${LAST_ACTIVITY} as "last_activity_at" ${rows.from} and q."id" = ? for update of q skip locked`,
        [...rows.params, id],
      );
      if (locked.length === 0) return null;
      const rfq = await em.findOneOrFail(QuoteRequest, { id });

      // When this request became due. Further back than the grace period, its
      // expiry is not news any more.
      const dueAt = new Date(locked[0]!.last_activity_at).getTime() + pass.expiryDays * DAY_MS;
      const notify = pass.now.getTime() - dueAt <= graceMs;

      rfq.status = 'Expired';
      rfq.expiredAt = pass.now;
      rfq.version += 1;
      await em.flush();

      const history = await this.deps.eventService.append(
        {
          quoteRequestId: rfq.id,
          eventType: 'expired',
          actor: { roleLabel: 'System' },
          payload: { type: 'expired', expiryDaysAtTime: pass.expiryDays },
        },
        em,
      );

      if (notify) {
        const recipients: NotificationRecipient[] = [{ customerAccountId: rfq.customerAccountId }];
        const assignments = await this.deps.salesRepAssignment.listForOrganization(rfq.organizationId);
        if (assignments.length > 0) {
          for (const a of assignments) recipients.push({ adminUserId: a.adminUserId });
        } else {
          // Unassigned-org fallback — notify every active admin.
          const everyAdmin = await this.deps.adminUsers.listAll();
          for (const a of everyAdmin) recipients.push({ adminUserId: a.id });
        }
        await this.deps.notificationService.enqueue(
          { quoteRequestId: rfq.id, sourceEventId: history.id, recipients, channels: ['email', 'in_app'] },
          em,
        );
      }

      return { organizationId: rfq.organizationId, notified: notify };
    });
    if (expired === null) return null;

    // After the commit, never from inside the transaction: outside an event
    // scope the bus runs subscribers at once, so an expiry whose commit then
    // failed would already have been announced — to outbound webhooks among
    // others — for a request that is still Pending.
    this.deps.events.emit('rfq.expired.v1', {
      eventId: randomUUID(),
      occurredAt: pass.now.toISOString(),
      rfqId: id,
      organizationId: expired.organizationId,
    });
    return { notified: expired.notified };
  }
}
