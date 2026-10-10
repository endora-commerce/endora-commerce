import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import type { AdminUserReadPort, SalesRepAssignmentPort } from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import type { RfqEventBus } from './rfq-service.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqNotificationService, NotificationRecipient } from './rfq-notification-service.js';
import { anyRowExists } from './scheduled-work-probe.js';

/**
 * RfqExpiryWorker — the sweep that moves Pending and Created from admin Quote
 * Requests past the configured expiry to `Expired`, writes the `expired`
 * history row, queues the notifications and announces `rfq.expired.v1`
 * (FR-030).
 *
 * `quote_requests.expiry_days = 0` disables it entirely. Otherwise a request is
 * due once `updated_at < now() - <expiry_days> days`, which catches
 * modifications and submissions alike.
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
 * of events at once.
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

const DAY_MS = 86_400_000;

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
    return anyRowExists(this.deps.emFactory(), [
      {
        from: `from "quote_requests" where "status" in (${EXPIRABLE_STATUSES.map(() => '?').join(', ')}) and "updated_at" < ?`,
        params: [...EXPIRABLE_STATUSES, new Date(now.getTime() - expiryDays * DAY_MS)],
      },
    ]);
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
    const cutoff = new Date(now.getTime() - expiryDays * DAY_MS);
    const due = await this.deps.emFactory().find(
      QuoteRequest,
      { status: { $in: [...EXPIRABLE_STATUSES] }, updatedAt: { $lt: cutoff } },
      { fields: ['id'], orderBy: { updatedAt: 'asc', id: 'asc' }, limit: batchSize },
    );

    let expiredCount = 0;
    let failedCount = 0;
    let notificationsSuppressedCount = 0;
    for (const { id } of due) {
      try {
        const outcome = await this.#expireOne(id, { now, cutoff, expiryDays });
        if (outcome === null) continue;
        expiredCount += 1;
        if (!outcome.notified) notificationsSuppressedCount += 1;
      } catch (error) {
        // A module switched off underneath the pass is never absorbed
        // (module-composition item 7): every other request would fail the same
        // way, and the pass stops here with all of them still due.
        rethrowIfModuleDisabled(error);
        failedCount += 1;
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
    pass: { now: Date; cutoff: Date; expiryDays: number },
  ): Promise<{ notified: boolean } | null> {
    // command-coverage-ignore: background expiry sweep — flips an overdue RFQ to
    // Expired on a timer, a system lifecycle job, not an operator-initiated write.
    const graceMs = this.deps.notificationGraceMs ?? RFQ_EXPIRY_NOTIFICATION_GRACE_MS;
    const expired = await this.deps.emFactory().transactional(async (em) => {
      // Re-read under a lock, with the pass's own predicate: the id list above
      // was read before this transaction began. `skip locked` lets two
      // consumers sweeping at once split the requests rather than queue.
      const rfq = await em.findOne(
        QuoteRequest,
        { id, status: { $in: [...EXPIRABLE_STATUSES] }, updatedAt: { $lt: pass.cutoff } },
        { lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE },
      );
      if (!rfq) return null;

      // When this request became due, read before the write below moves
      // `updated_at`. Further back than the grace period, its expiry is not
      // news any more.
      const dueAt = rfq.updatedAt.getTime() + pass.expiryDays * DAY_MS;
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
