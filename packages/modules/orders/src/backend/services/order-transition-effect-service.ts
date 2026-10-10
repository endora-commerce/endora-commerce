import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ORDER_TRANSITION_EFFECTS, type OrderTransitionEffectKind } from '@endora-commerce/contracts';
import {
  ModuleDisabledError,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import { ownerOfEffect, type OwedEffect } from '../domain/transition-effects.js';
import type {
  OrderTransitionEffectOrigin,
  OrderTransitionEffectReason,
} from '../entities/order-transition-effect.entity.js';
import type { OrderTransitionEffectHandlers } from './order-transition-effect-handlers.js';
import { anyRowExists, type WorkRows } from './scheduled-work-probe.js';

/**
 * The follow-ups an order transition owes, as a queue that lives in the
 * database (`specs/142-order-transition-atomicity/`, D1, D6).
 *
 * Three operations, and the split between them is the design:
 *
 *  - {@link record} writes the rows **on the caller's transaction** — the one
 *    that writes the status and its audit entry — so none of the three can
 *    exist without the others.
 *  - {@link drainForOrder} runs an order's outstanding rows right after that
 *    transaction commits, in the same request, so that in the ordinary case the
 *    stock and the credit are released by the time the caller is answered.
 *  - {@link sweep} runs whatever is still outstanding and due, on a clock. It
 *    is what recovers a failed attempt, a process that died after the commit,
 *    and a module that was switched off and is back.
 *
 * **The table is the queue.** Nothing here depends on Redis to know that a
 * release is owed; a scheduler only says *when* `sweep` is called.
 *
 * **One attempt holds one claim, and no connection.** An attempt claims its
 * row with a **committed lease**: one statement stamps `claimed_until` on a row
 * nobody else holds, and commits. The handler then runs with nothing of this
 * service's open, and one more statement records the outcome and drops the
 * lease. Whoever arrives second — the inline attempt, the sweep, another worker
 * process — finds the lease standing and skips the row.
 *
 * It was a row lock first (`for update skip locked`, held in a transaction
 * around the handler), and that shape starved the pool: the claim kept one
 * pooled connection while the release opened a second, so with more concurrent
 * cancellations than connections every claim sat waiting for a connection that
 * only another waiting claim could free. Measured through HTTP, 40 at once on a
 * pool of 10: two minutes, 30 committed cancellations answered 500, no release
 * completed. A request now needs one connection at a time, and a pool that is
 * busy merely queues.
 *
 * A lease expires. If the process dies between the claim and the outcome, the
 * row becomes claimable again after {@link EFFECT_CLAIM_LEASE_MS} and the
 * handler runs a second time — which both owners' releases tolerate, and which
 * the stock release makes safe against an *overlapping* second run as well by
 * locking the order row for its own short transaction
 * (`order-allocation-release.ts`).
 *
 * **There is no "gave up".** A failed row is retried with a capped back-off for
 * as long as it is outstanding; from the fifth failure on, every further one is
 * logged at `warn`.
 *
 * Raw SQL through an `EntityManager` (`em.execute`, never a connection-level
 * handle, which carries no transaction where `record` runs inside one): the
 * claim is a conditional `update … returning`, the insert needs `on conflict …
 * do nothing` against a partial index, and neither has an ORM spelling. The statements name this module's own
 * table and nothing else. They pass through no tenant filter, so each entry
 * point says what bounds it: `record` and `drainForOrder` act on one order the
 * caller has already loaded through the filter, `sweep` is a system
 * operation over every organization, run under a system scope by its caller,
 * and `hasSweepWork` — the one that runs with no scope at all — returns a
 * single boolean and no row.
 */

/** The first retry waits this long; each later one twice the one before. */
export const EFFECT_BACKOFF_BASE_MS = 60_000;
/** No retry ever waits longer than this. */
export const EFFECT_BACKOFF_CAP_MS = 60 * 60_000;
/** From this many failed attempts on, every further failure is logged at `warn`. */
export const EFFECT_WARN_FROM_ATTEMPTS = 5;
/**
 * How long a claim stands if nobody records an outcome. Long against a release
 * (milliseconds to seconds), short against the hour the back-off caps at.
 */
export const EFFECT_CLAIM_LEASE_MS = 5 * 60_000;
/** Upper bound on the rows one sweep pass attempts; the rest wait for the next pass. */
export const EFFECT_SWEEP_BATCH = 500;

const LAST_ERROR_MAX_LENGTH = 500;

/**
 * How long to wait after a failure, given how many attempts had failed
 * **before** it: one minute, doubling, capped at one hour.
 */
export function effectBackoffMs(failedAttemptsBefore: number): number {
  return Math.min(EFFECT_BACKOFF_BASE_MS * 2 ** failedAttemptsBefore, EFFECT_BACKOFF_CAP_MS);
}

/** What happened to one row in one attempt. */
export type EffectAttemptResult = 'done' | 'blocked' | 'failed' | 'skipped';

export type EffectAttemptSummary = Record<EffectAttemptResult, number>;

export interface OrderTransitionEffectServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly handlers: OrderTransitionEffectHandlers;
  /** The effective state of a module — the same question the handlers ask. */
  readonly isPresent: (moduleId: string) => boolean;
  readonly log: PlatformLogger;
}

interface ClaimedRow {
  id: string;
  order_id: string;
  effect: OrderTransitionEffectKind;
  reason: OrderTransitionEffectReason;
  attempts: number;
}

/** A condition over `order_transition_effects`, beside {@link OUTSTANDING}. */
interface EffectRows {
  readonly where: string;
  readonly params: readonly unknown[];
}

interface SweepPlan {
  readonly unblock: readonly EffectRows[];
  readonly block: ReadonlyArray<EffectRows & { readonly owner: string }>;
  readonly due: EffectRows | null;
}

/** Every statement of a pass is over rows that are still owed. */
const OUTSTANDING = `"completed_at" is null`;

/** The rows a pass statement selects, as a source the probe can ask about. */
const outstandingRows = (rows: EffectRows): WorkRows => ({
  from: `from "order_transition_effects" where ${OUTSTANDING} and ${rows.where}`,
  params: rows.params,
});

const emptySummary = (): EffectAttemptSummary => ({ done: 0, blocked: 0, failed: 0, skipped: 0 });

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, LAST_ERROR_MAX_LENGTH);
}

export class OrderTransitionEffectService {
  private readonly emFactory: () => EntityManager;
  private readonly handlers: OrderTransitionEffectHandlers;
  private readonly isPresent: (moduleId: string) => boolean;
  private readonly log: PlatformLogger;

  constructor(deps: OrderTransitionEffectServiceDeps) {
    this.emFactory = deps.emFactory;
    this.handlers = deps.handlers;
    this.isPresent = deps.isPresent;
    this.log = deps.log;
  }

  /**
   * Record what a transition owes, on the transaction that writes the
   * transition. Answers how many rows it wrote.
   *
   * An effect that is **already outstanding** for the order is not written
   * again: the release it describes is owed once, whichever transition asked
   * for it second — an order marked paid whose credit release is still waiting
   * and which is then cancelled owes one release, not two. The partial unique
   * index is what decides, so two writers cannot both win.
   */
  async record(
    tx: EntityManager,
    order: { readonly id: string; readonly organizationId: string },
    effects: readonly OwedEffect[],
    origin: OrderTransitionEffectOrigin,
  ): Promise<number> {
    let written = 0;
    for (const owed of effects) {
      const inserted = await tx.execute<Array<{ id: string }>>(
        `insert into "order_transition_effects"
           ("id", "organization_id", "order_id", "effect", "reason", "origin",
            "attempts", "next_attempt_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, 0, now(), now(), now())
         on conflict ("order_id", "effect") where "completed_at" is null do nothing
         returning "id"`,
        [randomUUID(), order.organizationId, order.id, owed.effect, owed.reason, origin],
      );
      written += inserted.length;
    }
    return written;
  }

  /**
   * Attempt every outstanding follow-up of one order, now.
   *
   * Called right after the transaction that recorded them has committed. It
   * does not wait for a back-off: a new transition of the order, or an
   * operator's repair, is a legitimate moment to try again.
   *
   * One row failing does not stop the next (FR-009): a credit release that
   * cannot run must not keep the stock held.
   */
  async drainForOrder(orderId: string): Promise<EffectAttemptSummary> {
    const outstanding = await this.emFactory().execute<Array<{ id: string }>>(
      `select "id" from "order_transition_effects"
        where "order_id" = ? and "completed_at" is null
        order by "created_at", "effect"`,
      [orderId],
    );
    const summary = emptySummary();
    for (const { id } of outstanding) {
      summary[await this.attempt(id, new Date(), { onlyIfDue: false })] += 1;
    }
    return summary;
  }

  /**
   * Whether a {@link sweep} at `now` would do anything at all — **yes or no,
   * and nothing else** (issue #120).
   *
   * The background consumer asks this before it opens its system scope, so
   * that a tick with nothing to do writes no `tenant.escape_hatch` audit row.
   * It is therefore the one statement of this service that runs with **no**
   * tenant context, and three properties keep that legitimate:
   *
   *  - **It answers one bit.** It goes through `anyRowExists`, which builds
   *    a `select exists(…)` and returns a boolean: no row, no order id, no
   *    organization id and no count leaves the statement, so the caller learns nothing about any organization — only
   *    whether to go and look, under the scope, where the look is recorded.
   *    Widening what this returns is widening an unaudited read; do not.
   *  - **It is the sweep's own predicate, not a copy of it.** Both read
   *    {@link sweepPlan}: a row to unblock because its owner is back, a row to
   *    mark as waiting because its owner is away, a row that is due. `false`
   *    means that pass would change and attempt nothing.
   *  - **Its answer is never handed to the pass.** `sweep()` re-reads
   *    everything inside the scope.
   *
   * A row that failed and is waiting out its back-off, or that is already
   * marked as waiting on an absent owner, is not work — which is what keeps a
   * module that stays off for months from costing one audit row a minute.
   */
  async hasSweepWork(now: Date = new Date()): Promise<boolean> {
    const plan = this.sweepPlan(now);
    return anyRowExists(
      this.emFactory(),
      [...plan.unblock, ...plan.block, ...(plan.due ? [plan.due] : [])].map(outstandingRows),
    );
  }

  /**
   * What one pass at `now` selects, as the three row sets it acts on — **the
   * one statement of them**, read by {@link sweep} to act and by
   * {@link hasSweepWork} to ask. They are built here and nowhere else so that
   * the question cannot drift from the pass: a condition added to a pass
   * statement is added to the probe by the same edit, and a probe narrower
   * than its pass — work that silently never happens — has no place to be
   * written.
   *
   *  - `unblock`: per present owner, the rows still marked as waiting on it;
   *  - `block`: per absent owner, the rows not yet marked as waiting on it;
   *  - `due`: the rows of present owners that are unclaimed and due — absent
   *    when no owner is present.
   *
   * `sweep` runs `unblock` before it reads `due`, and unblocking makes a row
   * due; the probe needs no ordering, because a row `unblock` would touch is
   * already a yes.
   */
  private sweepPlan(now: Date): SweepPlan {
    const unblock: EffectRows[] = [];
    const block: Array<EffectRows & { owner: string }> = [];
    const runnable: OrderTransitionEffectKind[] = [];
    for (const effect of ORDER_TRANSITION_EFFECTS) {
      const owner = ownerOfEffect(effect);
      if (this.isPresent(owner)) {
        runnable.push(effect);
        unblock.push({ where: `"effect" = ? and "blocked_on" is not null`, params: [effect] });
      } else {
        block.push({
          owner,
          where: `"effect" = ? and "blocked_on" is distinct from ?`,
          params: [effect, owner],
        });
      }
    }
    const due: EffectRows | null =
      runnable.length === 0
        ? null
        : {
            where: `("claimed_until" is null or "claimed_until" <= now())
          and "next_attempt_at" <= ?
          and "effect" in (${runnable.map(() => '?').join(', ')})`,
            params: [now, ...runnable],
          };
    return { unblock, block, due };
  }

  /**
   * One pass of the background consumer: attempt every outstanding row that is
   * due and whose owning module is present.
   *
   * Presence is asked **once per owner per pass**, and the rows of an absent
   * owner are excluded by the query — so a module that stays off for months
   * costs a pass one statement, not one attempt per waiting row (FR-008). That
   * statement marks the rows as waiting on the module, which is what the admin
   * order page reads; it touches only rows not already marked, so after the
   * first pass it updates nothing. Its mirror clears the mark once the owner
   * is present again. Neither waits behind an attempt in flight: a claim is a
   * committed lease, so no row lock outlives a single statement.
   *
   * Callers establish a system scope: this reads every organization's rows.
   */
  async sweep(now: Date = new Date()): Promise<EffectAttemptSummary> {
    const summary = emptySummary();
    const em = this.emFactory();

    const plan = this.sweepPlan(now);
    for (const rows of plan.unblock) {
      // The owner is back: a row still marked as waiting on it is no longer
      // waiting, whether or not its own retry is due in this pass.
      // It is also due **now**, whatever back-off it carried from before the
      // owner went away: a release that waited on a module runs within one
      // sweep of the module returning (FR-008), not up to an hour later.
      await em.execute(
        `update "order_transition_effects"
            set "blocked_on" = null, "next_attempt_at" = least("next_attempt_at", ?),
                "updated_at" = now()
          where ${OUTSTANDING} and ${rows.where}`,
        [now, ...rows.params],
      );
    }
    for (const rows of plan.block) {
      await em.execute(
        `update "order_transition_effects"
            set "blocked_on" = ?, "updated_at" = now()
          where ${OUTSTANDING} and ${rows.where}`,
        [rows.owner, ...rows.params],
      );
    }
    if (plan.due === null) return summary;

    const due = await em.execute<Array<{ id: string }>>(
      `select "id" from "order_transition_effects"
        where ${OUTSTANDING} and ${plan.due.where}
        order by "next_attempt_at"
        limit ${EFFECT_SWEEP_BATCH}`,
      [...plan.due.params],
    );
    for (const { id } of due) {
      summary[await this.attempt(id, now, { onlyIfDue: true })] += 1;
    }
    return summary;
  }

  /**
   * Claim one row, run its handler, record what happened.
   *
   * Three steps and none of them holds a connection across another: the claim
   * is one committed statement, the handler runs in the owner's own
   * transaction, the outcome is one committed statement. `skipped` means
   * somebody else holds the row or has already completed it — the other attempt
   * is the one that counts.
   *
   * The lease is measured on the database's clock, not on `now`: `now` is the
   * caller's notion of which rows are *due* and a test may set it hours ahead,
   * while a lease is about who is working on the row at this moment.
   */
  private async attempt(
    id: string,
    now: Date,
    options: { readonly onlyIfDue: boolean },
  ): Promise<EffectAttemptResult> {
    const em = this.emFactory();
    const [row] = await em.execute<ClaimedRow[]>(
      `update "order_transition_effects"
          set "claimed_until" = now() + (? * interval '1 millisecond'), "updated_at" = now()
        where "id" = ? and "completed_at" is null
          and ("claimed_until" is null or "claimed_until" <= now())
          ${options.onlyIfDue ? 'and "next_attempt_at" <= ?' : ''}
        returning "id", "order_id", "effect", "reason", "attempts"`,
      options.onlyIfDue ? [EFFECT_CLAIM_LEASE_MS, id, now] : [EFFECT_CLAIM_LEASE_MS, id],
    );
    if (!row) return 'skipped';

    let outcome;
    try {
      outcome = await this.handlers[row.effect]({ orderId: row.order_id, reason: row.reason });
    } catch (error) {
      // A module switched off between the handler's presence answer and its
      // port call is a statement about the platform, not a failed attempt: the
      // lease is handed back untouched and the refusal re-thrown, so the next
      // pass finds the row waiting on its owner (module-composition item 7).
      if (error instanceof ModuleDisabledError) {
        await em.execute(
          `update "order_transition_effects" set "claimed_until" = null, "updated_at" = now()
            where "id" = ?`,
          [id],
        );
      }
      rethrowIfModuleDisabled(error);
      // The narrow tolerance this service exists for: one follow-up failing
      // must be recorded and retried, and must not stop the order's other
      // follow-up or the rows after it.
      const attempts = row.attempts + 1;
      const lastError = describeError(error);
      await em.execute(
        `update "order_transition_effects"
            set "attempts" = ?, "last_error" = ?, "last_attempt_at" = ?,
                "next_attempt_at" = ?, "blocked_on" = null, "claimed_until" = null,
                "updated_at" = now()
          where "id" = ?`,
        [attempts, lastError, now, new Date(now.getTime() + effectBackoffMs(row.attempts)), id],
      );
      if (attempts >= EFFECT_WARN_FROM_ATTEMPTS) {
        this.log.warn(
          { orderId: row.order_id, effect: row.effect, attempts, lastError },
          'orders: an order follow-up keeps failing and is still being retried',
        );
      }
      return 'failed';
    }

    if (outcome.outcome === 'blocked') {
      // Not an attempt: nothing was tried, so nothing failed. The row stays
      // due and is picked up by the first pass after the module returns.
      await em.execute(
        `update "order_transition_effects"
            set "blocked_on" = ?, "claimed_until" = null, "updated_at" = now()
          where "id" = ?`,
        [outcome.moduleId, id],
      );
      return 'blocked';
    }

    await em.execute(
      `update "order_transition_effects"
          set "completed_at" = ?, "last_attempt_at" = ?, "result" = ?::jsonb,
              "blocked_on" = null, "last_error" = null, "claimed_until" = null,
              "updated_at" = now()
        where "id" = ?`,
      [now, now, JSON.stringify(outcome.result), id],
    );
    return 'done';
  }
}
