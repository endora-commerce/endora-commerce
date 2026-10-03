import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setEscapeHatchAuditSink,
  type EscapeHatchAuditRecord,
  type EscapeHatchAuditSink,
} from '../../tenancy/escape-hatch.js';
import { getTenantContext, runWithTenantContext } from '../../tenancy/tenant-context.js';
import { systemTenantContext } from '../../tenancy/resolve-tenant-context.js';
import { getCurrentPlatformScope } from '../scope.js';
import { AuditLogEntry } from './audit-log-entry.entity.js';

/**
 * The persistent escape-hatch audit sink (owner decision of 2026-10-03,
 * Constitution XI).
 *
 * `withSystemScope`, `withOrgScope` and `enterSystemScope` report every widening
 * of tenant scope to a sink, and until this file the only sink there was wrote
 * one stderr line. Cross-organisation access left no row in `audit_log_entries`,
 * so the one record of it lived as long as the log retention of whatever host
 * ran the process. This writer turns each report into an audit row.
 *
 * ## Asynchronous, aggregated, outside the caller's transaction
 *
 * The sink is called **synchronously** from the hatch and returns `void`; the
 * hatch is entered before any unit of work exists — in the auth hook, a worker's
 * first line, a boot reconciler — and most uses are reads. A co-transactional
 * insert (the Command Bus' `recordWithin`) has no transaction to join, and an
 * audit row that rolled back with a failed read would erase an access that did
 * happen. So the record is captured synchronously (who asked, from which
 * module, under which request) and written later, on a fork of its own, by a
 * timer. The caller never waits on the audit write and never holds a connection
 * the write needs, which is what keeps this from deadlocking a pool a worker has
 * exhausted.
 *
 * Two uses run on **every** authenticated storefront request
 * (`auth: resolve customer org` and `tenant: resolve customer roll-up flag`,
 * both in `customer_accounts`), so one row per call would double the request's
 * write load to record a fact that does not change between requests. Records
 * are therefore **aggregated** per flush window under a key of everything that
 * makes two accesses different for an auditor — scope, reason, target
 * organisation, module, entry point, actor and impersonation — and the row
 * carries how many times it happened, the first and last time, and up to
 * {@link MAX_REQUEST_IDS} request ids. Nothing is sampled away: every access is
 * counted in exactly one row, and an access by a different actor, against a
 * different organisation or for a different reason is a different row.
 *
 * ## What happens when the write fails
 *
 * Nothing is dropped silently. The stderr line is still written, synchronously,
 * before the record is queued, so a crash between the access and the flush
 * leaves the line in the log. A flush that fails puts its aggregates back,
 * merged with anything recorded since, writes
 * `tenant.escape_hatch.persist_failed` on stderr and is retried on the next
 * tick. The queue is bounded at {@link DEFAULT_MAX_PENDING_KEYS} distinct keys;
 * past it a new key folds into one overflow aggregate per scope and module, so
 * a long database outage costs detail and never the count. On `detach()` — a
 * composition's `dispose()` — the final flush runs, and whatever still could
 * not be written is printed as `tenant.escape_hatch.unpersisted`, one line per
 * aggregate, so the record ends in the log rather than nowhere.
 *
 * ## No recursion
 *
 * The write runs under `runWithTenantContext(systemTenantContext(...))`
 * directly, not through the hatch, so persisting a record reports nothing.
 * `AuditLogEntry` is a `@GlobalEntity` and would need no context at all; the
 * explicit system context is there so the flush never inherits whatever
 * context happened to be ambient when the timer was armed.
 */

/** The `audit_log_entries.action` every escape-hatch row carries. */
export const ESCAPE_HATCH_AUDIT_ACTION = 'tenant.escape_hatch';

/** How long records aggregate before they are written. */
export const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
/** Distinct aggregates that trigger a flush before the interval elapses. */
export const DEFAULT_FLUSH_THRESHOLD = 200;
/** Distinct aggregates held while the database is unreachable. */
export const DEFAULT_MAX_PENDING_KEYS = 5_000;
/** Request ids kept per aggregate; the count is never capped. */
export const MAX_REQUEST_IDS = 20;

const OVERFLOW_REASON = '(overflow: distinct records beyond the pending limit)';

export interface EscapeHatchAuditWriterOptions {
  /**
   * The EntityManager the rows are written through. A **getter that may answer
   * `undefined`**: an operator command opens its database lazily, and a run
   * that never opened one read no organisation's data, so its records have
   * nothing to persist into and are reported on stderr at `detach()`.
   */
  readonly em: () => EntityManager | undefined;
  readonly flushIntervalMs?: number;
  readonly flushThreshold?: number;
  readonly maxPendingKeys?: number;
  /** Where the writer's own diagnostics go. Defaults to stderr. */
  readonly log?: (line: string) => void;
  readonly now?: () => Date;
}

export interface EscapeHatchAuditWriter {
  /** Write everything recorded so far. Resolves after the attempt, failed or not. */
  flush(): Promise<void>;
  /** Final flush, then stop receiving records. Idempotent. */
  detach(): Promise<void>;
  /** Distinct aggregates not yet written. */
  readonly pendingCount: number;
}

interface Aggregate {
  readonly scope: EscapeHatchAuditRecord['scope'];
  readonly reason: string;
  readonly organizationId: string | null;
  readonly module: string;
  readonly entryPoint: string | null;
  readonly actorKind: string | null;
  readonly actorId: string | null;
  /**
   * The reason of the context the caller was already in — `actor:anonymous`
   * for an anonymous storefront request, a worker's own reason for a job.
   * What tells two `system` actors apart.
   */
  readonly actorContext: string | null;
  readonly actorAdminUserId: string | null;
  readonly impersonatedCustomerAccountId: string | null;
  readonly overflow: boolean;
  occurrences: number;
  firstAt: Date;
  lastAt: Date;
  requestIds: string[];
  requestIdsTruncated: boolean;
  /** Occurrences that ran under no request id — decides whether `requestId` is set. */
  withoutRequestId: number;
  ipAddress: string | null;
  userAgent: string | null;
}

/** One record and what was ambient when it was made. */
interface CapturedRecord {
  readonly record: EscapeHatchAuditRecord;
  readonly at: Date;
  readonly module: string;
  readonly entryPoint: string | null;
  readonly actorKind: string | null;
  readonly actorId: string | null;
  /**
   * The reason of the context the caller was already in — `actor:anonymous`
   * for an anonymous storefront request, a worker's own reason for a job.
   * What tells two `system` actors apart.
   */
  readonly actorContext: string | null;
  readonly actorAdminUserId: string | null;
  readonly impersonatedCustomerAccountId: string | null;
  readonly requestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

const stderr = (line: string): void => {
  process.stderr.write(line.endsWith('\n') ? line : `${line}\n`);
};

class Writer implements EscapeHatchAuditWriter {
  private pending = new Map<string, Aggregate>();
  private inFlight: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private detached = false;
  private readonly flushThreshold: number;
  private readonly maxPendingKeys: number;
  private readonly log: (line: string) => void;
  readonly now: () => Date;

  constructor(private readonly options: EscapeHatchAuditWriterOptions) {
    this.flushThreshold = options.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD;
    this.maxPendingKeys = options.maxPendingKeys ?? DEFAULT_MAX_PENDING_KEYS;
    this.log = options.log ?? stderr;
    this.now = options.now ?? ((): Date => new Date());
    this.timer = armFlushTimer(
      () => void this.flush(),
      options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    );
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  enqueue(captured: CapturedRecord): void {
    const { record } = captured;
    let overflow = false;
    let key = aggregateKey(captured);
    if (!this.pending.has(key) && this.pending.size >= this.maxPendingKeys) {
      overflow = true;
      key = JSON.stringify([record.scope, OVERFLOW_REASON, captured.module]);
    }
    const existing = this.pending.get(key);
    if (existing) {
      addOccurrence(existing, captured);
    } else {
      this.pending.set(key, {
        scope: record.scope,
        reason: overflow ? OVERFLOW_REASON : record.reason,
        organizationId: overflow ? null : (record.organizationId ?? null),
        module: captured.module,
        entryPoint: overflow ? null : captured.entryPoint,
        actorKind: overflow ? null : captured.actorKind,
        actorId: overflow ? null : captured.actorId,
        actorContext: overflow ? null : captured.actorContext,
        actorAdminUserId: overflow ? null : captured.actorAdminUserId,
        impersonatedCustomerAccountId: overflow ? null : captured.impersonatedCustomerAccountId,
        overflow,
        occurrences: 1,
        firstAt: captured.at,
        lastAt: captured.at,
        requestIds: captured.requestId ? [captured.requestId] : [],
        requestIdsTruncated: false,
        withoutRequestId: captured.requestId ? 0 : 1,
        ipAddress: captured.ipAddress,
        userAgent: captured.userAgent,
      });
    }
    if (this.pending.size >= this.flushThreshold) void this.flush();
  }

  flush(): Promise<void> {
    // One write at a time. A flush asked for while one runs waits for it and
    // then writes whatever arrived meanwhile, so a burst cannot open a second
    // connection per tick.
    // `writeOnce` never rejects — a failed write is handled inside it — so the
    // chain cannot wedge on one bad flush.
    const run = (this.inFlight ?? Promise.resolve()).then(() => this.writeOnce());
    this.inFlight = run;
    void run.then(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
    return run;
  }

  async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    removeWriter(this);
    await this.flush();
    if (this.pending.size === 0) return;
    const em = this.options.em();
    const msg =
      em === undefined
        ? 'tenant.escape_hatch.not_persisted'
        : 'tenant.escape_hatch.unpersisted';
    const why =
      em === undefined
        ? 'no database was opened by this process, so no organisation data was reachable'
        : 'the final audit write failed; this line is the only record';
    for (const aggregate of this.pending.values()) {
      this.log(
        JSON.stringify({
          level: em === undefined ? 'info' : 'error',
          msg,
          why,
          ...stateOf(aggregate),
        }),
      );
    }
    this.pending.clear();
  }

  private async writeOnce(): Promise<void> {
    if (this.pending.size === 0) return;
    const em = this.options.em();
    if (em === undefined) return;
    const batch = this.pending;
    this.pending = new Map();
    try {
      await runWithTenantContext(
        systemTenantContext('audit: persist escape-hatch records'),
        async () => {
          const fork = em.fork();
          for (const aggregate of batch.values()) {
            fork.persist(fork.create(AuditLogEntry, rowOf(aggregate)));
          }
          await fork.flush();
        },
      );
    } catch (error: unknown) {
      // Put the batch back, merged with whatever was recorded while it was
      // being written, and say so. The next tick retries.
      for (const [key, aggregate] of batch) {
        const newer = this.pending.get(key);
        this.pending.set(key, newer ? mergeAggregates(aggregate, newer) : aggregate);
      }
      this.log(
        JSON.stringify({
          level: 'error',
          msg: 'tenant.escape_hatch.persist_failed',
          pending: this.pending.size,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

/**
 * The flush timer. Deliberately **not** inside `enterSystemScope`, which
 * `check:entry-scope` otherwise asks of every timer: that would report an
 * escape-hatch widening on every tick, which this writer would then persist,
 * forever. The write opens its own system tenant context instead
 * (`writeOnce`), without the hatch. Unref'd: a pending flush must not keep a
 * process alive on its own; the owner's dispose path flushes explicitly.
 */
function armFlushTimer(tick: () => void, intervalMs: number): NodeJS.Timeout {
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return timer;
}

function aggregateKey(c: CapturedRecord): string {
  return JSON.stringify([
    c.record.scope,
    c.record.reason,
    c.record.organizationId ?? null,
    c.module,
    c.entryPoint,
    c.actorKind,
    c.actorId,
    c.actorContext,
    c.actorAdminUserId,
    c.impersonatedCustomerAccountId,
  ]);
}

function addOccurrence(aggregate: Aggregate, c: CapturedRecord): void {
  aggregate.occurrences += 1;
  if (c.at < aggregate.firstAt) aggregate.firstAt = c.at;
  if (c.at > aggregate.lastAt) aggregate.lastAt = c.at;
  if (c.requestId === null) {
    aggregate.withoutRequestId += 1;
  } else if (!aggregate.requestIds.includes(c.requestId)) {
    if (aggregate.requestIds.length < MAX_REQUEST_IDS) aggregate.requestIds.push(c.requestId);
    else aggregate.requestIdsTruncated = true;
  }
}

function mergeAggregates(older: Aggregate, newer: Aggregate): Aggregate {
  const requestIds = [...older.requestIds];
  let truncated = older.requestIdsTruncated || newer.requestIdsTruncated;
  for (const id of newer.requestIds) {
    if (requestIds.includes(id)) continue;
    if (requestIds.length < MAX_REQUEST_IDS) requestIds.push(id);
    else truncated = true;
  }
  return {
    ...older,
    occurrences: older.occurrences + newer.occurrences,
    firstAt: older.firstAt < newer.firstAt ? older.firstAt : newer.firstAt,
    lastAt: older.lastAt > newer.lastAt ? older.lastAt : newer.lastAt,
    requestIds,
    requestIdsTruncated: truncated,
    withoutRequestId: older.withoutRequestId + newer.withoutRequestId,
  };
}

/** The one request this aggregate belongs to, when it belongs to exactly one. */
function singleRequestId(a: Aggregate): string | null {
  return a.withoutRequestId === 0 && a.requestIds.length === 1 && !a.requestIdsTruncated
    ? (a.requestIds[0] ?? null)
    : null;
}

function stateOf(a: Aggregate): Record<string, unknown> {
  return {
    scope: a.scope,
    reason: a.reason,
    organizationId: a.organizationId,
    module: a.module,
    entryPoint: a.entryPoint,
    actor: { kind: a.actorKind, id: a.actorId, context: a.actorContext },
    occurrences: a.occurrences,
    firstAt: a.firstAt.toISOString(),
    lastAt: a.lastAt.toISOString(),
    requestIds: a.requestIds,
    requestIdsTruncated: a.requestIdsTruncated,
    ...(a.overflow ? { overflow: true } : {}),
  };
}

function rowOf(a: Aggregate): Partial<AuditLogEntry> & Pick<AuditLogEntry, 'action' | 'objectType' | 'objectId'> {
  const requestId = singleRequestId(a);
  return {
    action: ESCAPE_HATCH_AUDIT_ACTION,
    // A widening pinned to one organisation names it — the audit viewer links
    // `organization` rows to the organisation's page. A system widening crosses
    // all of them, and the row says so instead of naming none.
    objectType: a.organizationId ? 'organization' : 'tenant_scope',
    objectId: a.organizationId ?? a.scope,
    actedAt: a.firstAt,
    actorAdminUserId: a.actorAdminUserId,
    impersonatedCustomerAccountId: a.impersonatedCustomerAccountId,
    requestId,
    ipAddress: requestId ? a.ipAddress : null,
    userAgent: requestId ? a.userAgent?.slice(0, 255) ?? null : null,
    stateBefore: null,
    stateAfter: stateOf(a),
  };
}

// ---------------------------------------------------------------------------
// Module attribution
// ---------------------------------------------------------------------------

/**
 * Which module a widening came from, read off the call stack.
 *
 * The hatch takes a reason and nothing else, and reasons are prose. The stack
 * is the one thing that knows: the first frame outside the platform's own
 * tenancy and scope plumbing is the caller. A module is recognised in the three
 * places one lives — `packages/modules/<id>/` in this repository, an installed
 * `@endora-commerce/mod-<id>` package in an instance, and an overlay under
 * `apps/<deployment>/modules/<id>/`. A platform frame answers `platform`; a
 * frame that is neither (a host entry point, a script) answers `host`.
 *
 * Exported for its test; the writer caches it per reason.
 */
export function moduleFromStack(stack: string): string {
  const lines = stack.split('\n');
  for (const line of lines) {
    const frame = line.trim();
    if (!frame.startsWith('at ')) continue;
    if (/\(node:|\bat node:/.test(frame)) continue;
    if (OWN_FRAME.test(frame)) continue;
    const inRepo = /[\\/]packages[\\/]modules[\\/]([a-z0-9_]+)[\\/]/.exec(frame);
    if (inRepo?.[1]) return inRepo[1];
    const installed = /@endora-commerce[\\/+]mod-([a-z0-9-]+)[\\/@]/.exec(frame);
    if (installed?.[1]) return installed[1].replace(/-/g, '_');
    const overlay = /[\\/]apps[\\/][^\\/]+[\\/]modules[\\/]([a-z0-9_]+)[\\/]/.exec(frame);
    if (overlay?.[1]) return overlay[1];
    if (/[\\/]packages[\\/]platform[\\/]|@endora-commerce[\\/+]platform[\\/@]/.test(frame)) {
      return 'platform';
    }
    return 'host';
  }
  return 'platform';
}

/** The hatch's own frames, which every stack starts with and none of which is the caller. */
const OWN_FRAME =
  /[\\/](tenancy[\\/]escape-hatch|kernel[\\/]scope|kernel[\\/]audit[\\/]escape-hatch-audit-writer)\.(?:[cm]?[jt]s)\b/;

const MODULE_CACHE_LIMIT = 1_000;
const moduleByReason = new Map<string, string>();

function callerModule(reason: string): string {
  const cached = moduleByReason.get(reason);
  if (cached !== undefined) return cached;
  const holder: { stack?: string } = {};
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 40;
  Error.captureStackTrace(holder);
  Error.stackTraceLimit = limit;
  const found = moduleFromStack(holder.stack ?? '');
  // Reasons are mostly literals; the few interpolated ones (`cli: <argv>`, a
  // feed id) would grow the cache without bound, so it is cleared rather than
  // allowed to.
  if (moduleByReason.size >= MODULE_CACHE_LIMIT) moduleByReason.clear();
  moduleByReason.set(reason, found);
  return found;
}

// ---------------------------------------------------------------------------
// Attachment — one sink, a stack of writers
// ---------------------------------------------------------------------------

/**
 * The writers currently attached, most recent last. Only the most recent one
 * receives records: two compositions in one process (a test file, a CLI command
 * composing beside a server) must not write every access twice, and detaching
 * the inner one hands records back to the outer.
 */
const attached: Writer[] = [];
let previousSink: EscapeHatchAuditSink | undefined;

function capture(record: EscapeHatchAuditRecord, writer: Writer): CapturedRecord {
  // Read **before** the widened context exists: the sink is called by the
  // hatch synchronously, in the caller's own async context.
  const tenant = getTenantContext();
  const scope = getCurrentPlatformScope();
  const meta = scope?.requestMeta ?? null;
  const actor = tenant?.actor;
  const impersonation = tenant?.impersonation;
  return {
    record,
    at: writer.now(),
    module: callerModule(record.reason),
    entryPoint: record.entryPoint ?? scope?.entryPoint ?? null,
    actorKind: actor?.kind ?? null,
    actorId: actor?.id ?? null,
    actorContext: tenant?.reason ?? null,
    actorAdminUserId:
      impersonation?.realAdminUserId ?? (actor?.kind === 'admin' ? (actor.id ?? null) : null),
    impersonatedCustomerAccountId: impersonation?.impersonatedCustomerAccountId ?? null,
    requestId: meta?.requestId ?? null,
    ipAddress: meta?.ipAddress ?? null,
    userAgent: meta?.userAgent ?? null,
  };
}

const dispatch: EscapeHatchAuditSink = (record) => {
  // The previous sink first — by default the stderr line operators read, and
  // the record that survives a crash before the next flush.
  previousSink?.(record);
  const writer = attached[attached.length - 1];
  if (!writer) return;
  try {
    writer.enqueue(capture(record, writer));
  } catch (error: unknown) {
    // Auditing must never fail the access it describes; it must not be silent
    // about failing either.
    stderr(
      JSON.stringify({
        level: 'error',
        msg: 'tenant.escape_hatch.capture_failed',
        scope: record.scope,
        reason: record.reason,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
};

function removeWriter(writer: Writer): void {
  const index = attached.indexOf(writer);
  if (index !== -1) attached.splice(index, 1);
  if (attached.length === 0 && previousSink !== undefined) {
    setEscapeHatchAuditSink(previousSink);
    previousSink = undefined;
  }
}

/**
 * Persist every escape-hatch widening from now on, until `detach()`.
 *
 * Called by `composeApp` (every server, worker and composing CLI command, in
 * this repository and in an instance alike) and by the `module:*` operator
 * runtime, which never composes.
 */
export function attachEscapeHatchAuditWriter(
  options: EscapeHatchAuditWriterOptions,
): EscapeHatchAuditWriter {
  const writer = new Writer(options);
  if (attached.length === 0) previousSink = setEscapeHatchAuditSink(dispatch);
  attached.push(writer);
  return writer;
}
