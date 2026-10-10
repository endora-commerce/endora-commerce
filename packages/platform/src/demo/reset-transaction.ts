/**
 * The seam that lets a whole demo **reset** be one database transaction
 * (issue #143).
 *
 * ## Why a reset is one transaction and a seed is not
 *
 * A reset is the composition's withdrawal, then every module's own, then the
 * foundation's — a dozen bodies, any of which a foreign key can refuse. Run one
 * after another on their own connections, a refusal at the tenth leaves the
 * first nine committed: the instance has lost its demo payment methods and its
 * demo buyer and kept the demo organisation, which is a shop nobody can check
 * out of. That is not a property a careful ordering of steps can buy, because
 * the refusing constraint may belong to a table nobody here has heard of — an
 * installed module's, a deployment's own.
 *
 * So the entry point opens **one** transaction for the run and every body
 * writes inside it: the reset either completes or leaves the instance exactly
 * as it found it. A seed needs no such thing — it is idempotent by contract
 * (§2.4), so a seed that stopped part-way is repaired by running it again.
 *
 * ## How a module's body ends up inside it
 *
 * A demo body takes its `EntityManager` from its own cradle —
 * `context.ctx.cradle().emFactory()` — which hands out a fresh fork on a pooled
 * connection, outside any transaction. {@link demoContextWithin} gives each
 * body the same context with that one registration answered by the run's
 * transactional `EntityManager` instead. Nothing else of the cradle is touched.
 *
 * **What a `reset` body owes in return**: it writes through the
 * `EntityManager` it was handed — `em.nativeDelete`, `em.execute` — and never
 * through `em.getConnection().execute(…)` without a transaction context, which
 * takes a second connection, cannot see what the run has already deleted, and
 * waits on the rows the run has locked.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { IsolationLevel, type EntityManager } from '@mikro-orm/postgresql';

import { DemoResetRefusedError } from './refusal.js';
import { DemoRunFailedError } from './runner.js';

/** The part of a module context this file reads. */
interface CradleCarrier {
  cradle(): object;
}

/**
 * `contextFor`, with every module's `emFactory` answering `em`.
 *
 * The context is copied rather than proxied: it is a plain object of closures,
 * and a copy with one property replaced is a thing a debugger can read.
 */
export function demoContextWithin(
  em: EntityManager,
  contextFor: (moduleId: string) => unknown,
): (moduleId: string) => unknown {
  return (moduleId) => {
    const context = contextFor(moduleId) as CradleCarrier;
    const within = (): object =>
      new Proxy(context.cradle(), {
        get: (cradle, property) =>
          property === 'emFactory' ? () => em : Reflect.get(cradle, property),
      });
    return Object.create(Object.getPrototypeOf(context) as object | null, {
      ...Object.getOwnPropertyDescriptors(context),
      cradle: { value: within, enumerable: true },
    }) as unknown;
  };
}

// ── the transaction itself ─────────────────────────────────────────────────

/**
 * How long the reset's transaction may wait, in either direction.
 *
 * `lockTimeoutMs` bounds the reset waiting **for** somebody else — a session
 * that holds a lock on a row the reset wants. `idleTimeoutMs` bounds the reset
 * being waited **on** while it does nothing: the one shape a database cannot
 * detect, where a reset body sends a statement on a connection of its own, the
 * statement waits on a row the transaction has deleted, and the transaction
 * sits idle waiting for that statement to return. It is not a lock cycle —
 * only one side holds a lock — so Postgres never calls it a deadlock, and with
 * no bound it lasts until somebody kills the process, blocking every session
 * that touches those rows meanwhile.
 */
export interface DemoResetBounds {
  readonly lockTimeoutMs: number;
  readonly idleTimeoutMs: number;
}

export const DEFAULT_DEMO_RESET_BOUNDS: DemoResetBounds = {
  lockTimeoutMs: 60_000,
  idleTimeoutMs: 120_000,
};

/** A reset that failed for a reason nobody anticipated — printed with its stack. */
export class DemoResetFailedError extends Error {
  constructor(override readonly cause: unknown) {
    super(
      `[demo] the demo reset failed: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        `${NOTHING_CHANGED}`,
    );
    this.name = 'DemoResetFailedError';
    if (cause instanceof Error && cause.stack !== undefined) {
      this.stack = `${this.name}: ${this.message}\n${cause.stack}`;
    }
  }
}

const NOTHING_CHANGED =
  'Nothing has been changed: a demo reset runs in one transaction, and it was rolled back.';

const WROTE_OUTSIDE =
  'a reset body wrote outside the reset transaction — a demo composition or a module\'s ' +
  '`demo.reset` that takes a database connection of its own (`em.getConnection()`, ' +
  '`em.getKnex()`, `em.fork()`, its own `emFactory()`) instead of using the EntityManager it ' +
  'was handed. A composition or module written for a release before the one-transaction ' +
  'reset does this; upgrade it';

/** What the guard and the store share for one run. */
interface ResetRun {
  /** False once the run is over, so a timer born inside it is not refused for ever. */
  active: boolean;
  /** Set when a second connection was asked for, even if the body swallowed the refusal. */
  violated: boolean;
}

const currentReset = new AsyncLocalStorage<ResetRun>();

/** The part of knex this file reaches: where every non-transactional statement gets its connection. */
interface PoolClient {
  acquireConnection(...args: unknown[]): Promise<unknown>;
}

function poolClientOf(em: EntityManager): PoolClient | undefined {
  const connection = (em as { getConnection?: () => unknown }).getConnection?.() as
    | { getKnex?: () => { client?: PoolClient } }
    | undefined;
  const client = connection?.getKnex?.().client;
  return typeof client?.acquireConnection === 'function' ? client : undefined;
}

/** The SQLSTATE of the database error at the bottom of a failure, if there is one. */
function databaseErrorIn(error: unknown): { code: string; message: string } | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 6; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return { code, message: current.message };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function refusalIn(error: unknown): DemoResetRefusedError | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 6; depth += 1) {
    if (current instanceof DemoResetRefusedError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Run `work` as **the** reset: one transaction, one snapshot, bounded waits,
 * and no second connection.
 *
 *  - **One snapshot** (`REPEATABLE READ`). What the reset counts and what it
 *    deletes are the same rows: a payment committed by another session after
 *    the financial pre-flight has counted is not quietly deleted with the
 *    rest — it is invisible to the deletes and its foreign key refuses the
 *    run. Under the default isolation each statement saw a newer database.
 *  - **Bounded waits** ({@link DemoResetBounds}), set on the transaction and
 *    gone with it.
 *  - **No second connection.** While `work` runs, anything in its async
 *    context that asks the pool for a connection is refused on the spot. That
 *    turns the hang described on {@link DemoResetBounds} into an immediate,
 *    named refusal with nothing sent to the database; the idle bound remains
 *    for a body that brings a database client of its own, which no pool guard
 *    can see.
 *
 * Every way out other than success is presented the same way: what refused,
 * and that nothing has been changed.
 */
export async function runDemoResetTransaction<T>(
  em: EntityManager,
  work: (tx: EntityManager) => Promise<T>,
  bounds: DemoResetBounds = DEFAULT_DEMO_RESET_BOUNDS,
): Promise<T> {
  const run: ResetRun = { active: true, violated: false };
  const pool = poolClientOf(em);
  const acquire = pool?.acquireConnection;
  if (pool !== undefined && acquire !== undefined) {
    pool.acquireConnection = function guarded(this: unknown, ...args: unknown[]) {
      const inside = currentReset.getStore();
      if (inside?.active === true) {
        inside.violated = true;
        return Promise.reject(wroteOutside());
      }
      return acquire.apply(this, args);
    };
  }
  let backendPid: number | undefined;
  try {
    return await em.transactional(
      async (tx) => {
        await tx.execute(`set local lock_timeout = ${Math.trunc(bounds.lockTimeoutMs)}`);
        await tx.execute(
          `set local idle_in_transaction_session_timeout = ${Math.trunc(bounds.idleTimeoutMs)}`,
        );
        const [session] = await tx.execute<{ pid: number }[]>(`select pg_backend_pid() as pid`);
        backendPid = session?.pid;
        const result = await currentReset.run(run, () => work(tx));
        // A body that caught the refusal and carried on has still written
        // nothing outside — the statement was never sent — but it has not done
        // what it meant to either, and a reset that commits past that is a
        // half-reset by another name.
        if (run.violated) throw wroteOutside();
        return result;
      },
      { isolationLevel: IsolationLevel.REPEATABLE_READ },
    );
  } catch (error) {
    throw await presentable(error, em, backendPid, bounds);
  } finally {
    run.active = false;
    if (pool !== undefined && acquire !== undefined) pool.acquireConnection = acquire;
  }
}

function wroteOutside(): DemoResetRefusedError {
  return new DemoResetRefusedError(`[demo] the demo reset was stopped: ${WROTE_OUTSIDE}. ${NOTHING_CHANGED}`);
}

/** Is the session the reset ran on still there? It is not after the idle bound ended it. */
async function sessionEnded(em: EntityManager, pid: number | undefined): Promise<boolean> {
  if (pid === undefined) return false;
  try {
    const rows = await em.execute<{ n: string }[]>(
      `select count(*)::text as n from pg_stat_activity where pid = ?`,
      [pid],
    );
    return rows[0]?.n === '0';
  } catch {
    return false;
  }
}

/**
 * The error an operator reads. A refusal is returned as itself, a refusal by
 * the database is made one, and everything else keeps its stack — each saying
 * that nothing was changed, which is true of all of them.
 */
async function presentable(
  error: unknown,
  em: EntityManager,
  pid: number | undefined,
  bounds: DemoResetBounds,
): Promise<unknown> {
  const refusal = refusalIn(error);
  if (refusal !== undefined) return refusal;

  if (await sessionEnded(em, pid)) {
    return new DemoResetRefusedError(
      `[demo] the demo reset was stopped: its transaction did nothing for more than ` +
        `${Math.round(bounds.idleTimeoutMs / 1000)} s while something waited on it, and the ` +
        `database ended it. The likely cause: ${WROTE_OUTSIDE}. The reset itself was rolled ` +
        `back and changed nothing; a statement that body sent on its own connection is not ` +
        `part of the reset and may have been applied.`,
    );
  }

  const where = error instanceof DemoRunFailedError ? ` (module '${error.moduleId}')` : '';
  const database = databaseErrorIn(error);
  if (database !== undefined) {
    // Class 23 — an integrity constraint. Nearly always a foreign key from a
    // row the reset does not know how to delete onto one it does.
    if (database.code.startsWith('23')) {
      return new DemoResetRefusedError(
        `[demo] the database refused the demo reset${where}: ${database.message}. ` +
          `${NOTHING_CHANGED} Something still refers to a row the reset removes; the rows ` +
          `that do have to be withdrawn first, by the module that owns them. No flag of ` +
          `this command overrides a foreign key.`,
      );
    }
    // 40001 / 40P01 — the database changed under the reset's snapshot.
    if (database.code.startsWith('40')) {
      return new DemoResetRefusedError(
        `[demo] the demo reset was stopped${where}: the data it was removing was changed by ` +
          `another session while it ran (${database.message}). ${NOTHING_CHANGED} Run it again.`,
      );
    }
    // 55P03 — lock_not_available: the lock bound.
    if (database.code === '55P03') {
      return new DemoResetRefusedError(
        `[demo] the demo reset was stopped${where}: it waited more than ` +
          `${Math.round(bounds.lockTimeoutMs / 1000)} s for a row another session has ` +
          `locked. ${NOTHING_CHANGED} If nothing else is writing to this database, the ` +
          `likely cause is ${WROTE_OUTSIDE}.`,
      );
    }
  }
  // A module's failure already says which module and that nothing changed.
  if (error instanceof DemoRunFailedError) return error;
  return new DemoResetFailedError(error);
}
