import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ORDER_TRANSITION_EFFECTS, type OrderTransitionEffectKind } from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled, type PlatformLogger } from '@endora-commerce/platform/kernel';
import { ownerOfEffect, type OwedEffect } from '../domain/transition-effects.js';
import type {
  OrderTransitionEffectOrigin,
  OrderTransitionEffectReason,
} from '../entities/order-transition-effect.entity.js';
import type { OrderTransitionEffectHandlers } from './order-transition-effect-handlers.js';

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
 * **One attempt holds one row lock.** Every attempt claims its row with
 * `select … for update skip locked` inside its own transaction and keeps that
 * transaction open while the handler runs, so the inline attempt, the sweep and
 * a second worker process can never run the same follow-up at once — whoever
 * arrives second skips the row. That matters most for the stock release, which
 * has no row lock of its own on the owner's side. The handler itself runs in
 * the owner's transaction, not this one: a failed release must be *recorded*,
 * and a transaction a failed statement has aborted can record nothing.
 *
 * **There is no "gave up".** A failed row is retried with a capped back-off for
 * as long as it is outstanding; from the fifth failure on, every further one is
 * logged at `warn`.
 *
 * Raw SQL through the transaction's own `EntityManager` (`em.execute`, never a
 * connection-level handle, which carries no transaction): the claim needs
 * `skip locked`, the insert needs `on conflict … do nothing` against a partial
 * index, and neither has an ORM spelling. The statements name this module's own
 * table and nothing else. They pass through no tenant filter, so each entry
 * point says what bounds it: `record` and `drainForOrder` act on one order the
 * caller has already loaded through the filter, and `sweep` is a system
 * operation over every organization, run under a system scope by its caller.
 */

/** The first retry waits this long; each later one twice the one before. */
export const EFFECT_BACKOFF_BASE_MS = 60_000;
/** No retry ever waits longer than this. */
export const EFFECT_BACKOFF_CAP_MS = 60 * 60_000;
/** From this many failed attempts on, every further failure is logged at `warn`. */
export const EFFECT_WARN_FROM_ATTEMPTS = 5;
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
   * One pass of the background consumer: attempt every outstanding row that is
   * due and whose owning module is present.
   *
   * Presence is asked **once per owner per pass**, and the rows of an absent
   * owner are excluded by the query — so a module that stays off for months
   * costs a pass one statement, not one attempt per waiting row (FR-008). That
   * statement marks the rows as waiting on the module, which is what the admin
   * order page reads; it touches only rows not already marked, so after the
   * first pass it updates nothing. Its mirror clears the mark once the owner
   * is present again.
   *
   * Callers establish a system scope: this reads every organization's rows.
   */
  async sweep(now: Date = new Date()): Promise<EffectAttemptSummary> {
    const summary = emptySummary();
    const em = this.emFactory();

    const runnable: OrderTransitionEffectKind[] = [];
    for (const effect of ORDER_TRANSITION_EFFECTS) {
      const owner = ownerOfEffect(effect);
      if (this.isPresent(owner)) {
        runnable.push(effect);
        // The owner is back: a row still marked as waiting on it is no longer
        // waiting, whether or not its own retry is due in this pass.
        await em.execute(
          `update "order_transition_effects"
              set "blocked_on" = null, "updated_at" = now()
            where "completed_at" is null and "effect" = ? and "blocked_on" is not null`,
          [effect],
        );
        continue;
      }
      await em.execute(
        `update "order_transition_effects"
            set "blocked_on" = ?, "updated_at" = now()
          where "completed_at" is null and "effect" = ?
            and "blocked_on" is distinct from ?`,
        [owner, effect, owner],
      );
    }
    if (runnable.length === 0) return summary;

    const due = await em.execute<Array<{ id: string }>>(
      `select "id" from "order_transition_effects"
        where "completed_at" is null
          and "next_attempt_at" <= ?
          and "effect" in (${runnable.map(() => '?').join(', ')})
        order by "next_attempt_at"
        limit ${EFFECT_SWEEP_BATCH}`,
      [now, ...runnable],
    );
    for (const { id } of due) {
      summary[await this.attempt(id, now, { onlyIfDue: true })] += 1;
    }
    return summary;
  }

  /**
   * Claim one row and run its handler.
   *
   * `skipped` means somebody else holds the row or has already completed it —
   * the other attempt is the one that counts.
   */
  private async attempt(
    id: string,
    now: Date,
    options: { readonly onlyIfDue: boolean },
  ): Promise<EffectAttemptResult> {
    return this.emFactory().transactional(async (tx) => {
      const [row] = await tx.execute<ClaimedRow[]>(
        `select "id", "order_id", "effect", "reason", "attempts"
           from "order_transition_effects"
          where "id" = ? and "completed_at" is null
            ${options.onlyIfDue ? 'and "next_attempt_at" <= ?' : ''}
          for update skip locked`,
        options.onlyIfDue ? [id, now] : [id],
      );
      if (!row) return 'skipped';

      let outcome;
      try {
        outcome = await this.handlers[row.effect]({ orderId: row.order_id, reason: row.reason });
      } catch (error) {
        // The narrow tolerance this service exists for: one follow-up failing
        // must be recorded and retried, and must not stop the order's other
        // follow-up or the rows after it. A module switched off between the
        // handler's presence answer and its port call is not that — it is a
        // statement about the platform, and it is re-thrown: the claim rolls
        // back untouched and the next pass finds the row waiting on its owner.
        rethrowIfModuleDisabled(error);
        const attempts = row.attempts + 1;
        const lastError = describeError(error);
        await tx.execute(
          `update "order_transition_effects"
              set "attempts" = ?, "last_error" = ?, "last_attempt_at" = ?,
                  "next_attempt_at" = ?, "blocked_on" = null, "updated_at" = now()
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
        await tx.execute(
          `update "order_transition_effects"
              set "blocked_on" = ?, "updated_at" = now()
            where "id" = ?`,
          [outcome.moduleId, id],
        );
        return 'blocked';
      }

      await tx.execute(
        `update "order_transition_effects"
            set "completed_at" = ?, "last_attempt_at" = ?, "result" = ?::jsonb,
                "blocked_on" = null, "last_error" = null, "updated_at" = now()
          where "id" = ?`,
        [now, now, JSON.stringify(outcome.result), id],
      );
      return 'done';
    });
  }
}
