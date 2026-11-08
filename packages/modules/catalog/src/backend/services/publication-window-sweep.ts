import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  enterSystemScope,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import { anyRowExists, type WorkRows } from './scheduled-work-probe.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/research.md` R9, FR-024, SC-005) —
 * publication-window transitions reaching what does not read at request time.
 *
 * Storefront reads and the search filter evaluate the window when they run, so
 * they are exact. Webhook subscribers, feed caches and search-document
 * freshness learn of a window bound being crossed the way they learn of a
 * status change: one `product.updated.v1` with `changedFields:
 * ['publicationWindow']` per product. **No stored status is written** (A-4).
 *
 * A bound is "crossed" when it lies in `(lastSweep, now]`; the global window on
 * `products` and every **overridden** channel window count. `lastSweep` is a
 * Redis key this module owns — a watermark, not a cache — and a missing key
 * reads as `now − 2 × interval`. The sweep is idempotent: a crash between the
 * emits and the watermark re-emits on the next tick, and the subscribers'
 * upserts are harmless repeats.
 *
 * **An idle tick enters no scope** (issue #894). The tick first asks
 * {@link PublicationWindowSweep.hasDueTransitions} — one boolean, read with no
 * tenant context — and opens the system scope only when a bound was crossed, so
 * an instance with nothing crossing writes no `tenant.escape_hatch` audit row
 * every five minutes. An idle tick leaves the watermark where it is — the
 * probe writes nothing — so the next tick asks about the longer interval from
 * the same point. That interval holds no crossing the idle tick ruled out
 * except a bound since edited back into it, and that edit announced itself;
 * the sweep's repeat of it is one more harmless upsert.
 */

export const PUBLICATION_WINDOW_SWEEP_QUEUE = 'catalog.publication-window.sweep';
export const PUBLICATION_WINDOW_SWEEP_SCHEDULER_ID = 'catalog.publication-window.sweep';
/** Every five minutes. */
export const PUBLICATION_WINDOW_SWEEP_EVERY_MS = 5 * 60 * 1000;
/** The watermark: epoch milliseconds of the last completed sweep. */
export const PUBLICATION_WINDOW_WATERMARK_KEY = 'catalog:publication-window:last-sweep';

export interface PublicationWindowSweepResult {
  /** The half-open interval swept: `(from, until]`. */
  from: Date;
  until: Date;
  productIds: string[];
}

/** `product.updated.v1`, as this sweep emits it. */
export interface PublicationWindowEvent {
  eventId: string;
  occurredAt: string;
  productId: string;
  changedFields: ['publicationWindow'];
}

export class PublicationWindowSweep {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly watermark: Pick<Redis, 'get' | 'set'>,
    private readonly emit: (event: PublicationWindowEvent) => void | Promise<void>,
    private readonly everyMs: number = PUBLICATION_WINDOW_SWEEP_EVERY_MS,
  ) {}

  /**
   * Whether a {@link sweep} at `now` would emit anything — **yes or no, and
   * nothing else** (issue #894).
   *
   * The tick asks this before it opens its system scope, so that a tick with
   * no bound crossed writes no `tenant.escape_hatch` audit row. It runs with no
   * tenant context and returns one bit, through `anyRowExists`: no product
   * leaves the statement. The watermark it reads is this module's own Redis
   * key, not an Organization's data, and it writes nothing — moving the
   * watermark stays the sweep's. The rows are {@link crossedRows}, the sweep's
   * own, over the interval the sweep would cover; the answer is never handed to
   * the sweep, which re-reads inside the scope.
   */
  async hasDueTransitions(now: Date = new Date()): Promise<boolean> {
    const { from, until } = await this.interval(now);
    if (from.getTime() >= until.getTime()) return false;
    return anyRowExists(this.emFactory(), this.crossedRows(from, until));
  }

  /**
   * The products with a bound crossed in `(from, until]`, as row sources —
   * **the one statement of the predicate**, read by {@link hasDueTransitions}
   * to ask and by {@link sweep} to list. The first source is the global window
   * on `products`, the second every overridden channel window; each is aliased
   * so the sweep can select the product id from it. A condition added here is
   * added to both by the same edit, so the question cannot drift from the
   * sweep.
   */
  crossedRows(from: Date, until: Date): readonly [WorkRows, WorkRows] {
    const crossed = (column: string): string => `(${column} > ? and ${column} <= ?)`;
    return [
      {
        from:
          `from products p where p.deleted_at is null` +
          ` and (${crossed('p.publish_from')} or ${crossed('p.publish_until')})`,
        params: [from, until, from, until],
      },
      {
        from:
          `from product_channel_scopes c join products p on p.id = c.product_id and p.deleted_at is null` +
          ` where c.window_overridden and (${crossed('c.publish_from')} or ${crossed('c.publish_until')})`,
        params: [from, until, from, until],
      },
    ];
  }

  async sweep(now: Date = new Date()): Promise<PublicationWindowSweepResult> {
    const { from, until } = await this.interval(now);
    if (from.getTime() >= until.getTime()) return { from, until, productIds: [] };

    const [products, channelScopes] = this.crossedRows(from, until);
    const rows = await this.emFactory().execute<Array<{ id: string }>>(
      `select p.id::text as id ${products.from}
       union
       select c.product_id::text as id ${channelScopes.from}
       order by id`,
      [...products.params, ...channelScopes.params],
    );
    const productIds = rows.map((row) => row.id);
    for (const productId of productIds) {
      await this.emit({
        eventId: randomUUID(),
        occurredAt: until.toISOString(),
        productId,
        changedFields: ['publicationWindow'],
      });
    }
    await this.watermark.set(PUBLICATION_WINDOW_WATERMARK_KEY, String(until.getTime()));
    return { from, until, productIds };
  }

  /** `(lastSweep, now]`, which may be empty. A missing watermark reads as `now − 2 × interval`. */
  private async interval(now: Date): Promise<{ from: Date; until: Date }> {
    const stored = await this.watermark.get(PUBLICATION_WINDOW_WATERMARK_KEY);
    const storedMs = stored === null ? Number.NaN : Number(stored);
    const from = new Date(Number.isFinite(storedMs) ? storedMs : now.getTime() - 2 * this.everyMs);
    return { from, until: now };
  }
}

/** The audit reason the sweep's system scope records. */
export const PUBLICATION_WINDOW_SWEEP_SCOPE_REASON = 'catalog: publication-window sweep tick';

export type PublicationWindowSweepJobData = Record<string, never>;

export interface PublicationWindowSweepTickDeps {
  sweep: Pick<PublicationWindowSweep, 'sweep' | 'hasDueTransitions'>;
  log: PlatformLogger;
}

/**
 * The body of one pass, inside the scope. A failed sweep is logged and not
 * re-thrown — the next tick retries from the same watermark. A module switched
 * off is never absorbed.
 */
async function sweepInScope(deps: PublicationWindowSweepTickDeps): Promise<void> {
  try {
    const result = await deps.sweep.sweep();
    if (result.productIds.length > 0) {
      deps.log.info(
        { event: 'catalog.publication_window.sweep', crossed: result.productIds.length },
        'catalog: publication-window bounds crossed',
      );
    }
  } catch (error) {
    rethrowIfModuleDisabled(error);
    deps.log.warn(
      {
        event: 'catalog.publication_window.sweep',
        error: error instanceof Error ? error.message : String(error),
      },
      'catalog: the publication-window sweep failed; the next tick retries',
    );
  }
}

/**
 * What BullMQ invokes for one job: ask whether any bound was crossed, and open
 * the system scope only when one was (issue #894).
 *
 * A tick has no caller, so it opens its own system scope, and the event
 * subscribers the sweep reaches (search, webhooks) run in it. Entering the
 * scope is what writes the `tenant.escape_hatch` audit record, so a scope
 * entered on every tick is 288 audit rows a day on an instance where no
 * publication window was crossed.
 *
 * **The question is asked outside any scope and answers yes or no, nothing
 * else** (`PublicationWindowSweep.hasDueTransitions`). Everything the sweep
 * reads or writes is read inside the scope, by `sweep()` itself — the answer
 * decides only *whether* the scope is entered.
 *
 * **A question that cannot be answered counts as yes.** The tick then runs
 * with its scope and its audit record: a failing probe may cost an audit row,
 * and can never save one. A module switched off is the one thing that is not a
 * failed question, and is never absorbed.
 */
export async function runPublicationWindowSweepTick(deps: PublicationWindowSweepTickDeps): Promise<void> {
  let hasWork = true;
  try {
    hasWork = await deps.sweep.hasDueTransitions();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  await enterSystemScope(PUBLICATION_WINDOW_SWEEP_SCOPE_REASON, () => sweepInScope(deps));
}

/**
 * The Job Scheduler and its consumer, where the host says this process consumes
 * queues and offers a connection — the `assets_library` retention sweep's
 * shape. `attach` is `ctx.worker`, which stops the consumer with the module.
 * `queuePrefix` is BullMQ's key prefix and is left alone in production: a test
 * that shares a Redis with other runs sets one of its own (the quote-request
 * expiry sweep's shape).
 */
export async function startPublicationWindowSweep(input: {
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly sweep: Pick<PublicationWindowSweep, 'sweep' | 'hasDueTransitions'>;
  readonly log: PlatformLogger;
  readonly attach: (worker: Worker<PublicationWindowSweepJobData>) => void;
  readonly onClose: (close: () => Promise<void>) => void;
  readonly queuePrefix?: string;
}): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const prefix = queuePrefix !== undefined ? { prefix: queuePrefix } : {};
  const queue = new Queue<PublicationWindowSweepJobData>(PUBLICATION_WINDOW_SWEEP_QUEUE, {
    connection: moduleQueueRedis,
    ...prefix,
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    new Worker<PublicationWindowSweepJobData>(
      PUBLICATION_WINDOW_SWEEP_QUEUE,
      // The scope is opened one call down, in `runPublicationWindowSweepTick`,
      // and only for a tick that has a crossed bound to announce.
      () => runPublicationWindowSweepTick({ sweep: input.sweep, log: input.log }),
      { connection: moduleQueueRedis, concurrency: 1, ...prefix },
    ),
  );
  await queue.upsertJobScheduler(
    PUBLICATION_WINDOW_SWEEP_SCHEDULER_ID,
    { every: PUBLICATION_WINDOW_SWEEP_EVERY_MS },
    { name: 'sweep', data: {} },
  );
  return true;
}
