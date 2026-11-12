import type { OutboxData } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { ModuleDisabledError } from '../../kernel/lifecycle/plugin-helpers.js';
import type { PlatformLogger } from '../../kernel/logging.js';
import { enterPlatformScope } from '../../kernel/scope.js';
import { orgPinnedTenantContext } from '../../tenancy/resolve-tenant-context.js';
import { getTenantContext } from '../../tenancy/tenant-context.js';
import type { AfterCommitContext, AfterCommitHandler } from '../hooks/types.js';
import {
  COMMAND_OUTBOX_ABSENT_MODULE_DELAY_MS,
  COMMAND_OUTBOX_BACKOFF_BASE_MS,
  COMMAND_OUTBOX_BACKOFF_MAX_MS,
  COMMAND_OUTBOX_BATCH_SIZE,
  COMMAND_OUTBOX_DEAD_RETENTION_MS,
  COMMAND_OUTBOX_DELIVERED_RETENTION_MS,
  COMMAND_OUTBOX_HANDLER_FAILED,
  COMMAND_OUTBOX_HOOK_UNREGISTERED,
  COMMAND_OUTBOX_LEASE_MS,
  COMMAND_OUTBOX_MAX_ATTEMPTS,
  COMMAND_OUTBOX_MAX_BATCHES_PER_TICK,
} from './constants.js';
import { PermanentOutboxFailure } from './errors.js';
import type { ClaimedOutboxRow, OutboxFailure, OutboxStore } from './store.js';

/**
 * One pass of the command outbox drain (`specs/176-command-hooks-outbox/`
 * FR-032 – FR-037, `contracts/outbox-and-admin-api.md` § Delivery).
 *
 * Reclaim expired leases, then claim batch after batch and deliver each row to
 * its handler, then purge what retention allows. What a row becomes:
 *
 * | Outcome | Row |
 * | --- | --- |
 * | handler returned | `delivered` |
 * | handler threw, attempts < 10 | `pending`, due after `min(30 s · 2^(n-1), 1 h)` |
 * | handler threw on attempt 10, or threw `PermanentOutboxFailure` | `dead` |
 * | handler module not present, or a `ModuleDisabledError` | `pending` in 30 s, attempt given back |
 * | module present, handler no longer registered | `dead`, `hook-unregistered` |
 *
 * **A failure stores a code and a class, never a message** (FR-035). The
 * code is the error's own when it is code-shaped — an `HttpError`'s, a
 * `PermanentOutboxFailure`'s, a Node `code` like `ECONNREFUSED` — and
 * `handler-failed` otherwise. The outbox is platform-global; a message can
 * carry anything the handler was looking at.
 *
 * **Each row runs in a scope of its own, pinned to its Organization**
 * (FR-034, R-16): `single-org`, the system as actor, the recorded request id as
 * the scope's — so a Command the handler runs records the request that caused
 * it. A row with no Organization runs in the tick's own system scope, again
 * with the recorded request id. The actor recorded at commit is handed over as
 * `causation`, and never re-entered: a past operator's reach is not something
 * a background job may resume.
 *
 * Rows are delivered one at a time. A handler is at-least-once: a lease that
 * runs out under a slow handler is reclaimed and the row delivered again, and
 * `messageId` is what the handler dedupes on.
 */

/** What the drain asks of the composed command-hook registry. */
export interface OutboxHandlerLookup {
  /** Whether the handler's module is present on the effective state right now. */
  isPresent(moduleId: string): boolean;
  /** The registered `afterCommit` handler `moduleId#hookId`, with the action it is on. */
  afterCommitHandler(
    moduleId: string,
    hookId: string,
  ): { readonly action: string; readonly handler: AfterCommitHandler<OutboxData> } | undefined;
}

export interface OutboxDrainDeps {
  readonly store: OutboxStore;
  readonly handlers: OutboxHandlerLookup;
  readonly log: PlatformLogger;
  /** The drain's clock. Every due, lease and retention decision reads it. */
  readonly now?: () => Date;
}

export interface OutboxDrainResult {
  reclaimed: number;
  delivered: number;
  retried: number;
  dead: number;
  released: number;
  purged: { delivered: number; dead: number };
  /** The tick stopped at its batch bound with rows still due; the next tick continues. */
  reachedBatchLimit: boolean;
}

/** The wait before attempt `attempt + 1`, after attempt `attempt` (1-based) failed. */
export function commandOutboxBackoffMs(attempt: number): number {
  return Math.min(COMMAND_OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(attempt - 1, 0), COMMAND_OUTBOX_BACKOFF_MAX_MS);
}

const CODE_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function codeShaped(value: unknown): value is string {
  return typeof value === 'string' && CODE_RE.test(value);
}

/** The code and class a failure is stored as. Never the message. */
export function outboxFailureOf(error: unknown): OutboxFailure {
  const errorClass =
    error instanceof Error ? error.constructor.name || error.name || 'Error' : typeof error === 'object' ? 'Object' : typeof error;
  if (error instanceof PermanentOutboxFailure) {
    return { code: codeShaped(error.code) ? error.code : 'permanent-failure', errorClass };
  }
  if (error instanceof HttpError) {
    return { code: codeShaped(error.code) ? error.code : COMMAND_OUTBOX_HANDLER_FAILED, errorClass };
  }
  const own = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return { code: codeShaped(own) ? own : COMMAND_OUTBOX_HANDLER_FAILED, errorClass };
}

function causationOf(row: ClaimedOutboxRow): AfterCommitContext<OutboxData>['causation'] {
  return {
    actor: {
      kind: row.actorKind,
      actorAdminUserId: row.actorAdminUserId,
      impersonatedCustomerAccountId: row.impersonatedCustomerAccountId,
      actorCustomerAccountId: row.actorCustomerAccountId,
    },
    requestId: row.requestId,
    committedAt: row.createdAt.toISOString(),
  };
}

/** Run `fn` in the scope a row's handler runs in: pinned to its Organization, or the tick's own. */
async function inRowScope(row: ClaimedOutboxRow, fn: () => Promise<void>): Promise<void> {
  const opts = { requestMeta: { requestId: row.requestId }, entryPoint: 'worker' as const };
  if (row.organizationId !== null) {
    const reason = `command_outbox: deliver ${row.action} to ${row.hookModule}#${row.hookId}`;
    await enterPlatformScope(orgPinnedTenantContext(row.organizationId, reason), fn, opts);
    return;
  }
  const tick = getTenantContext();
  if (tick === undefined) {
    // Fail closed: a row with no Organization runs in the tick's system scope,
    // and a drain called with no scope around it has none to give it.
    throw new Error(
      `[command_outbox] row ${row.id} (${row.action}) has no Organization and the drain is running with no ` +
        'tenant context to deliver it in. Run the drain through runCommandOutboxDrainTick, which opens the ' +
        'system scope.',
    );
  }
  await enterPlatformScope(tick, fn, opts);
}

export async function drainCommandOutbox(deps: OutboxDrainDeps): Promise<OutboxDrainResult> {
  const { store, handlers, log } = deps;
  const clock = deps.now ?? ((): Date => new Date());
  const after = (ms: number): Date => new Date(clock().getTime() + ms);
  const result: OutboxDrainResult = {
    reclaimed: 0,
    delivered: 0,
    retried: 0,
    dead: 0,
    released: 0,
    purged: { delivered: 0, dead: 0 },
    reachedBatchLimit: false,
  };

  const deliver = async (row: ClaimedOutboxRow): Promise<void> => {
    if (!handlers.isPresent(row.hookModule)) {
      await store.release(row, after(COMMAND_OUTBOX_ABSENT_MODULE_DELAY_MS));
      result.released += 1;
      return;
    }
    const registered = handlers.afterCommitHandler(row.hookModule, row.hookId);
    if (registered === undefined || registered.action !== row.action) {
      await store.markDead(row, clock(), { code: COMMAND_OUTBOX_HOOK_UNREGISTERED, errorClass: null });
      result.dead += 1;
      log.warn(
        { messageId: row.id, action: row.action, hookModule: row.hookModule, hookId: row.hookId },
        'command_outbox: dead-lettered a row whose handler its module no longer registers',
      );
      return;
    }
    try {
      await inRowScope(row, () =>
        registered.handler({
          messageId: row.id,
          attempt: row.attempts,
          action: row.action,
          objectType: row.objectType,
          objectId: row.objectId,
          organizationId: row.organizationId,
          data: row.data,
          causation: causationOf(row),
          log,
        }),
      );
    } catch (error) {
      if (error instanceof ModuleDisabledError) {
        await store.release(row, after(COMMAND_OUTBOX_ABSENT_MODULE_DELAY_MS));
        result.released += 1;
        return;
      }
      const failure = outboxFailureOf(error);
      const context = { messageId: row.id, action: row.action, hookModule: row.hookModule, hookId: row.hookId, attempt: row.attempts, ...failure };
      if (error instanceof PermanentOutboxFailure || row.attempts >= COMMAND_OUTBOX_MAX_ATTEMPTS) {
        await store.markDead(row, clock(), failure);
        result.dead += 1;
        log.warn(context, 'command_outbox: dead-lettered a row');
        return;
      }
      await store.markRetry(row, after(commandOutboxBackoffMs(row.attempts)), failure);
      result.retried += 1;
      log.info(context, 'command_outbox: a delivery failed and will be retried');
      return;
    }
    await store.markDelivered(row, clock());
    result.delivered += 1;
  };

  result.reclaimed = await store.reclaimExpiredLeases(clock());
  for (let batch = 1; batch <= COMMAND_OUTBOX_MAX_BATCHES_PER_TICK; batch += 1) {
    const rows = await store.claim(clock(), COMMAND_OUTBOX_BATCH_SIZE, after(COMMAND_OUTBOX_LEASE_MS));
    for (const row of rows) await deliver(row);
    if (rows.length < COMMAND_OUTBOX_BATCH_SIZE) break;
    if (batch === COMMAND_OUTBOX_MAX_BATCHES_PER_TICK) result.reachedBatchLimit = true;
  }
  const now = clock().getTime();
  result.purged = await store.purge(
    new Date(now - COMMAND_OUTBOX_DELIVERED_RETENTION_MS),
    new Date(now - COMMAND_OUTBOX_DEAD_RETENTION_MS),
  );
  return result;
}
