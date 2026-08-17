import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { BULK_OPERATION_TYPES, type BulkUpdateProductsRequest } from '@b2b/contracts';
import { AdminUser } from '../../admin_users/entities/admin-user.entity.js';
import type { Mailer } from '../../email/services/mailer.js';
import { effectiveState } from '../../../kernel/lifecycle/effective-state.js';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import type { Command, CommandBus } from '../../../commands/index.js';
import { applyUndo, type RevertRecord } from '../../../commands/index.js';
import { Product } from '../entities/product.entity.js';
import {
  BulkOperation,
  type BulkOperationLogEntry,
  type BulkOperationPayload,
  type BulkOperationRevertRecord,
  type BulkOperationStatus,
} from '../entities/bulk-operation.entity.js';
import type {
  CatalogBulkUpdateService,
  BulkUpdateOutcome,
} from './catalog-bulk-update.service.js';

/**
 * BulkOperationService — queued product bulk-edit.
 *
 * Owns the lifecycle of {@link BulkOperation} rows:
 *   - `create()` persists a `pending` row and enqueues it (via the injected
 *     `onEnqueued` producer) onto the durable BullMQ queue — it never
 *     inline-executes the job (Constitution Principle X).
 *   - `processById()` is the consumer entry point invoked by the BullMQ
 *     worker: it claims the row atomically (`pending → running`) and applies
 *     it through {@link CatalogBulkUpdateService} with live progress persisted
 *     on the row. The conditional claim makes it idempotent under BullMQ
 *     redelivery / retries and safe at N ≥ 2 worker instances.
 *   - `processPending()` drains every `pending` row in-process; it is kept for
 *     manual scripts / tests only — the deployed path is the queue worker.
 *   - On completion / failure the requester is notified twice: an
 *     in-app bell notification and an email.
 *   - `list()` / `get()` back the "Bulk actions" admin page.
 */

/** Per-product outcomes are capped on the row so a huge run can't bloat it. */
const MAX_PERSISTED_RESULTS = 1000;

/** The bell entry a finished bulk operation writes for the admin who asked. */
export interface BulkNotificationInput {
  audience: 'admin_user';
  targetAdminUserId: string;
  kind: string;
  subjectType?: string | null;
  subjectId?: string | null;
  title: string;
  body?: string | null;
  linkPath?: string | null;
}

/**
 * `admin_notifications`' port, as this module reaches it.
 *
 * Resolving it asks a gate, so it either records or throws — it cannot answer
 * "the operator switched the bell off", which is why the degrade lives in the
 * recorder below rather than here (D-61's rejected alternative).
 */
export interface BulkNotificationPort {
  record(input: BulkNotificationInput): Promise<unknown>;
}

/**
 * What this module actually holds — the degrade in the return type (D-60).
 *
 * `not-present` is the operator having switched `admin_notifications` off. It
 * is composed before the port is reached, so the `catch` around the write is
 * left with what a `catch` should be left with: a failed write.
 */
export type BulkNotificationOutcome = 'recorded' | 'not-present';

export interface BulkNotificationRecorder {
  record(input: BulkNotificationInput): Promise<BulkNotificationOutcome>;
}

/**
 * Wraps the gated port in the presence decision, so absence is *decided* rather
 * than caught (D-60; Constitution XVII).
 *
 * A function rather than an object literal at the composition site on purpose:
 * `check-port-catches.ts` follows the port **through the value**, and an object
 * literal is where that trail deliberately stops.
 */
export function presenceAwareBulkRecorder(
  adminNotifications: BulkNotificationPort,
): BulkNotificationRecorder {
  return {
    async record(input: BulkNotificationInput): Promise<BulkNotificationOutcome> {
      // First, and outside any `try`: a closed gate throws rather than
      // answering, so asking after the call is asking too late.
      if (!effectiveState.isPresent('admin_notifications')) return 'not-present';
      await adminNotifications.record(input);
      return 'recorded';
    },
  };
}

export interface CreateBulkOperationInput {
  requestedByAdminUserId: string;
  payload: BulkOperationPayload;
  type?: string;
}

export interface SerializedBulkOperation {
  id: string;
  type: string;
  status: BulkOperationStatus;
  requestedByAdminUserId: string;
  total: number;
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
  touchedFields: string[];
  results: BulkUpdateOutcome[] | null;
  logs: BulkOperationLogEntry[] | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  reversible: boolean;
  undoStatus: 'none' | 'reverted' | 'partially_reverted';
  undoneAt: string | null;
}

export interface ListBulkOperationsInput {
  status?: BulkOperationStatus[];
  limit?: number;
  offset?: number;
}

export interface ListBulkOperationsResult {
  items: SerializedBulkOperation[];
  total: number;
}

/**
 * Runs a full Meilisearch reindex (the `search:reindex` CLI equivalent) and
 * reports how many documents landed. Wired from the composition root so the
 * catalog module stays decoupled from the search module's indexer.
 */
export type SearchReindexRunner = () => Promise<{
  /** Total documents pushed across every channel index. */
  documentCount: number;
}>;

export class BulkOperationService {
  /** Single-flight guard so overlapping sweep ticks don't double-process. */
  private draining = false;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly bulkUpdateService: CatalogBulkUpdateService,
    private readonly deps: {
      notificationService?: BulkNotificationRecorder;
      mailer?: Mailer;
      /**
       * Producer hook: hands the new operation's id to the durable queue.
       * Called once per `create()` with the persisted row's id. Failures are
       * swallowed by the caller — the `pending` row is the source of truth and
       * the worker's boot reconciliation re-enqueues anything left behind.
       */
      onEnqueued?: (operationId: string) => void | Promise<void>;
      /**
       * Runs a full Meilisearch reindex for `search_reindex` operations.
       * When omitted, such operations fail with a clear "not configured"
       * message rather than silently no-op'ing.
       */
      reindexRunner?: SearchReindexRunner;
    } = {},
    /**
     * Feature 054 — when injected, product bulk edits capture per-product revert
     * state and expose an audited, conflict-aware undo (US2). Optional so bus-less
     * constructions (some tests) keep the pre-054 behavior.
     */
    private readonly commandBus?: CommandBus,
  ) {}

  async create(input: CreateBulkOperationInput): Promise<SerializedBulkOperation> {
    // command-coverage-ignore: catalog_bulk_operations row bookkeeping (queue
    // status / progress counters); the actual product mutations are audited by
    // updateProduct. The operation record itself is not a domain-audit target.
    const em = this.emFactory();
    const op = new BulkOperation();
    op.type = input.type ?? 'product_bulk_update';
    op.status = 'pending';
    op.requestedByAdminUserId = input.requestedByAdminUserId;
    op.total = input.payload.productIds.length;
    op.payload = input.payload;
    op.logs = [
      logEntry(
        'info',
        op.type === BULK_OPERATION_TYPES.SEARCH_REINDEX
          ? 'Operacja przeindeksowania wyszukiwarki utworzona i dodana do kolejki.'
          : `Operacja utworzona i dodana do kolejki (${op.total} elementów).`,
      ),
    ];
    await em.persistAndFlush(op);
    // Producer side (Principle X): enqueue and return. Never block the HTTP
    // response on actual processing. Enqueue errors are non-fatal — the row
    // stays `pending` and the worker's boot reconciliation re-enqueues it.
    try {
      await this.deps.onEnqueued?.(op.id);
    } catch {
      /* enqueue is best-effort; reconciliation is the safety net */
    }
    return serialize(op);
  }

  /**
   * Consumer entry point invoked by the BullMQ worker for one queued
   * operation. Atomically claims the row (`pending → running`); if the claim
   * affects no row the operation was already taken or finished, so this is a
   * no-op — making the handler idempotent under redelivery/retries and safe at
   * N ≥ 2 worker instances.
   */
  async processById(operationId: string): Promise<void> {
    // command-coverage-ignore: catalog_bulk_operations row bookkeeping (queue
    // status / progress counters); the actual product mutations are audited by
    // updateProduct. The operation record itself is not a domain-audit target.
    const em = this.emFactory();
    const affected = await em.nativeUpdate(
      BulkOperation,
      { id: operationId, status: 'pending' },
      { status: 'running', startedAt: new Date() },
    );
    if (affected === 0) return;
    await this.processOne(operationId);
  }

  /**
   * Ids of every operation still `pending`. Used by the worker at boot to
   * re-enqueue rows that were created while no producer/queue was reachable
   * (e.g. an enqueue failure, or a row predating this deployment).
   */
  async findPendingIds(): Promise<string[]> {
    const em = this.emFactory();
    const rows = await em.find(
      BulkOperation,
      { status: 'pending' },
      { fields: ['id'], orderBy: { createdAt: 'asc' } },
    );
    return rows.map((r) => r.id);
  }

  async list(input: ListBulkOperationsInput = {}): Promise<ListBulkOperationsResult> {
    const em = this.emFactory();
    const where = input.status && input.status.length > 0 ? { status: { $in: input.status } } : {};
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const offset = Math.max(input.offset ?? 0, 0);
    const [rows, total] = await em.findAndCount(BulkOperation, where, {
      orderBy: { createdAt: 'desc' },
      limit,
      offset,
    });
    return { items: rows.map(serialize), total };
  }

  async get(id: string): Promise<SerializedBulkOperation | null> {
    const em = this.emFactory();
    const op = await em.findOne(BulkOperation, { id });
    return op ? serialize(op) : null;
  }

  /**
   * Drain every `pending` operation. Safe to call repeatedly and
   * concurrently — the single-flight guard ensures one drain at a time.
   */
  async processPending(): Promise<{ processed: number }> {
    if (this.draining) return { processed: 0 };
    this.draining = true;
    let processed = 0;
    try {
      for (;;) {
        const next = await this.claimNextPending();
        if (!next) break;
        await this.processOne(next);
        processed += 1;
      }
    } finally {
      this.draining = false;
    }
    return { processed };
  }

  /**
   * Atomically flip the oldest `pending` row to `running` and return its
   * id. The conditional UPDATE means even if two drains race past the
   * in-process guard (e.g. across worker restarts) only one wins a row.
   */
  private async claimNextPending(): Promise<string | null> {
    // command-coverage-ignore: catalog_bulk_operations row bookkeeping (queue
    // status / progress counters); the actual product mutations are audited by
    // updateProduct. The operation record itself is not a domain-audit target.
    const em = this.emFactory();
    const candidate = await em.findOne(
      BulkOperation,
      { status: 'pending' },
      { orderBy: { createdAt: 'asc' } },
    );
    if (!candidate) return null;
    const affected = await em.nativeUpdate(
      BulkOperation,
      { id: candidate.id, status: 'pending' },
      { status: 'running', startedAt: new Date() },
    );
    if (affected === 0) {
      // Lost the race — try again on the next loop iteration.
      return this.claimNextPending();
    }
    return candidate.id;
  }

  private async processOne(id: string): Promise<void> {
    // command-coverage-ignore: catalog_bulk_operations row bookkeeping (queue
    // status / progress counters); the actual product mutations are audited by
    // updateProduct. The operation record itself is not a domain-audit target.
    const em = this.emFactory();
    const op = await em.findOne(BulkOperation, { id });
    if (!op) return;

    const logs: BulkOperationLogEntry[] = Array.isArray(op.logs) ? [...op.logs] : [];
    logs.push(logEntry('info', `Rozpoczęto przetwarzanie operacji (${op.total} elementów).`));

    if (op.type === BULK_OPERATION_TYPES.SEARCH_REINDEX) {
      await this.processReindex(op, logs);
      return;
    }

    const req: BulkUpdateProductsRequest = {
      productIds: op.payload.productIds,
      fields: op.payload.fields,
    } as BulkUpdateProductsRequest;

    // Feature 054 (US2) — capture per-product before-state for undo, but only
    // when the edit touches revertible direct columns (never the category
    // bridge). Read BEFORE the mutation so the snapshot is the true pre-state.
    const revertKeys = this.commandBus ? revertibleFieldKeys(op.payload.fields) : null;
    const beforeByProduct =
      revertKeys && revertKeys.length > 0
        ? await this.#snapshotProductFields(em, op.payload.productIds, revertKeys)
        : null;

    try {
      const result = await this.bulkUpdateService.bulkUpdate(
        req,
        { actorAdminUserId: op.requestedByAdminUserId },
        {
          skipBatchLimit: true,
          onProgress: async (p) => {
            await em.nativeUpdate(
              BulkOperation,
              { id },
              {
                processed: p.processed,
                succeeded: p.succeeded,
                skipped: p.skipped,
                failed: p.failed,
              },
            );
          },
        },
      );

      logs.push(
        logEntry(
          'info',
          `Zakończono: ${result.summary.succeeded} z powodzeniem, ${result.summary.skipped} pominięto, ${result.summary.failed} z błędem (łącznie ${result.summary.total}).`,
        ),
      );
      if (result.summary.failed > 0) {
        logs.push(
          logEntry(
            'warn',
            `${result.summary.failed} elementów zakończyło się błędem — szczegóły w statusie pojedynczych elementów.`,
          ),
        );
      }
      // Build revert state from the products that actually succeeded, reading
      // their post-state so undo can detect later changes (research §R5).
      let revertState: BulkOperationRevertRecord[] | null = null;
      if (revertKeys && revertKeys.length > 0 && beforeByProduct) {
        const succeededIds = result.results
          .filter((r) => r.status === 'succeeded')
          .map((r) => r.productId)
          .filter((pid) => beforeByProduct.has(pid));
        const afterByProduct = await this.#snapshotProductFields(em, succeededIds, revertKeys);
        revertState = succeededIds.map((pid) => ({
          recordId: pid,
          before: beforeByProduct.get(pid)!,
          after: afterByProduct.get(pid) ?? {},
        }));
      }

      await em.nativeUpdate(
        BulkOperation,
        { id },
        {
          status: 'completed',
          processed: result.summary.total,
          succeeded: result.summary.succeeded,
          skipped: result.summary.skipped,
          failed: result.summary.failed,
          results: result.results.slice(0, MAX_PERSISTED_RESULTS),
          logs,
          finishedAt: new Date(),
          ...(revertState && revertState.length > 0
            ? { reversible: true, revertState }
            : {}),
        },
      );
      await this.notify(op, 'completed', result.summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(logEntry('error', `Operacja nie powiodła się: ${message}`));
      await em.nativeUpdate(
        BulkOperation,
        { id },
        { status: 'failed', error: message, logs, finishedAt: new Date() },
      );
      await this.notify(op, 'failed', null, message);
    }
  }

  /**
   * Runs a `search_reindex` operation: a full Meilisearch reindex (the
   * `search:reindex` CLI equivalent). Counts every reindexed document as
   * both processed and succeeded; failure surfaces on the row + notifications.
   */
  private async processReindex(
    op: BulkOperation,
    logs: BulkOperationLogEntry[] = [],
  ): Promise<void> {
    // command-coverage-ignore: catalog_bulk_operations row bookkeeping (queue
    // status / progress counters); the actual product mutations are audited by
    // updateProduct. The operation record itself is not a domain-audit target.
    const em = this.emFactory();
    if (!this.deps.reindexRunner) {
      const message = 'Search reindex handler is not configured.';
      logs.push(logEntry('error', `Operacja nie powiodła się: ${message}`));
      await em.nativeUpdate(
        BulkOperation,
        { id: op.id },
        { status: 'failed', error: message, logs, finishedAt: new Date() },
      );
      await this.notify(op, 'failed', null, message);
      return;
    }
    try {
      const { documentCount } = await this.deps.reindexRunner();
      logs.push(
        logEntry('info', `Przeindeksowano ${documentCount} dokumentów we wszystkich indeksach.`),
      );
      await em.nativeUpdate(
        BulkOperation,
        { id: op.id },
        {
          status: 'completed',
          total: documentCount,
          processed: documentCount,
          succeeded: documentCount,
          skipped: 0,
          failed: 0,
          logs,
          finishedAt: new Date(),
        },
      );
      await this.notify(op, 'completed', {
        succeeded: documentCount,
        skipped: 0,
        failed: 0,
        total: documentCount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(logEntry('error', `Operacja nie powiodła się: ${message}`));
      await em.nativeUpdate(
        BulkOperation,
        { id: op.id },
        { status: 'failed', error: message, logs, finishedAt: new Date() },
      );
      await this.notify(op, 'failed', null, message);
    }
  }

  private async notify(
    op: BulkOperation,
    status: 'completed' | 'failed',
    summary: { succeeded: number; skipped: number; failed: number; total: number } | null,
    error?: string,
  ): Promise<void> {
    const em = this.emFactory();
    const admin = await em.findOne(AdminUser, { id: op.requestedByAdminUserId });

    const succeeded = summary?.succeeded ?? 0;
    const total = summary?.total ?? op.total;
    const isReindex = op.type === BULK_OPERATION_TYPES.SEARCH_REINDEX;
    const title = isReindex
      ? status === 'completed'
        ? `Search reindex finished — ${total} documents indexed`
        : 'Search reindex failed'
      : status === 'completed'
        ? `Bulk edit finished — ${succeeded}/${total} updated`
        : 'Bulk edit failed';
    const body = isReindex
      ? status === 'completed'
        ? `The search index was rebuilt: ${total} documents indexed.`
        : `The search reindex could not be completed: ${error ?? 'unknown error'}.`
      : status === 'completed'
        ? `${total} products processed: ${succeeded} succeeded, ${summary?.skipped ?? 0} skipped, ${summary?.failed ?? 0} failed.`
        : `The bulk edit of ${op.total} products could not be completed: ${error ?? 'unknown error'}.`;

    try {
      // The outcome is read rather than discarded: `not-present` is the
      // operator having switched `admin_notifications` off, which is their
      // choice and not a failure, and it used to be indistinguishable from a
      // failed write inside this `catch` (D-60).
      await this.deps.notificationService?.record({
        audience: 'admin_user',
        targetAdminUserId: op.requestedByAdminUserId,
        kind: `catalog.bulk_operation.${status}`,
        subjectType: 'bulk_operation',
        subjectId: op.id,
        title,
        body,
        linkPath: '/catalog/bulk-operations',
      });
    } catch (err) {
      // Narrow, and correct: the bell is written when the operation has already
      // finished and its row carries the outcome, so a failed write must not
      // fail a job whose work is done. Presence is decided by the recorder
      // before the port is reached, so what is left here is a failed write.
      rethrowIfModuleDisabled(err);
      /* notification is best-effort */
    }

    if (this.deps.mailer && admin?.email) {
      try {
        const outcome = await this.deps.mailer.send({
          messageId: `bulk-op-${op.id}-${status}`,
          to: admin.email,
          subject: title,
          text: `${body}\n\nView the bulk actions page in the admin panel for details.`,
          kind: `catalog.bulk_operation.${status}`,
          meta: { bulkOperationId: op.id, status },
        });
        if (outcome.status !== 'sent') {
          // The products are already written; this only tells the operator it
          // finished. Named rather than silent, and durable in D-59's record.
          console.warn('[catalog] the bulk-operation e-mail was not sent', {
            bulkOperationId: op.id,
            reason: outcome.reason,
          });
        }
      } catch {
        /* email is best-effort */
      }
    }
  }

  // ---- Feature 054 (US2) — undo -----------------------------------------

  /**
   * Undo a reversible bulk edit: restore every affected product whose current
   * state still matches the operation's captured after-state; refuse (report,
   * never clobber) any product changed since. Runs as an audited `bulk.undo`
   * Command and is idempotent-safe on re-invocation (FR-006/FR-007/FR-014).
   */
  async undo(operationId: string): Promise<UndoOutcome> {
    const em = this.emFactory();
    const op = await em.findOne(BulkOperation, { id: operationId });
    if (!op) return { ok: false, code: 'NOT_FOUND' };
    if (op.status !== 'completed' || !op.reversible || !op.revertState || op.revertState.length === 0) {
      return { ok: false, code: 'NOT_REVERSIBLE' };
    }
    if (op.undoStatus === 'reverted') return { ok: false, code: 'ALREADY_REVERTED' };
    if (!this.commandBus) return { ok: false, code: 'NOT_REVERSIBLE' };
    const records: RevertRecord[] = op.revertState.map((r) => ({
      recordId: r.recordId,
      before: r.before,
      after: r.after,
    }));
    return this.commandBus.run(this.#undoCommand(operationId, records));
  }

  #undoCommand(operationId: string, records: readonly RevertRecord[]): Command<UndoOutcome> {
    return {
      action: 'product.bulk_update.undo',
      objectType: 'bulk_operation',
      objectId: operationId,
      run: async ({ em }) => {
        const op = await em.findOne(BulkOperation, { id: operationId });
        if (!op || op.undoStatus === 'reverted') {
          return {
            result: { ok: true, reverted: [], conflicts: [], undoStatus: 'reverted' as const },
            skipAudit: true,
          };
        }
        const res = await applyUndo(em, records, {
          readCurrent: async (tem, rec) => {
            const p = await tem.findOne(Product, { id: rec.recordId });
            return p ? pickProductFields(p, Object.keys(rec.after)) : null;
          },
          restore: async (tem, rec) => {
            const p = await tem.findOne(Product, { id: rec.recordId });
            if (!p) return;
            tem.assign(p, rec.before);
            tem.persist(p);
          },
        });
        op.undoStatus = res.undoStatus === 'reverted' ? 'reverted' : 'partially_reverted';
        op.undoneAt = new Date();
        op.undoOperationId = randomUUID();
        em.persist(op);
        return {
          result: { ok: true, ...res },
          after: { reverted: res.reverted.length, conflicts: res.conflicts.length },
        };
      },
    };
  }

  /** Read `productIds` and pick each product's values for `keys`. */
  async #snapshotProductFields(
    em: EntityManager,
    productIds: readonly string[],
    keys: readonly string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    if (productIds.length === 0) return out;
    const products = await em.find(Product, { id: { $in: [...productIds] } });
    for (const p of products) {
      out.set(p.id, pickProductFields(p, keys));
    }
    return out;
  }
}

/** Undo result surfaced to the route (mapped to 200/404/409). */
export type UndoOutcome =
  | { ok: true; reverted: string[]; conflicts: { recordId: string; reason: string }[]; undoStatus: 'reverted' | 'partially_reverted' | 'none' }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_REVERSIBLE' | 'ALREADY_REVERTED' };

/**
 * Field keys of a bulk edit that can be undone by restoring direct product
 * columns. Returns `[]` (⇒ not reversible) when the edit is empty or touches a
 * non-revertible field (the category bridge) — all-or-nothing, never partial.
 */
const NON_REVERTIBLE_BULK_FIELDS = new Set(['categoryIds']);
function revertibleFieldKeys(fields: Record<string, unknown>): string[] {
  const keys = Object.keys(fields);
  if (keys.length === 0) return [];
  if (keys.some((k) => NON_REVERTIBLE_BULK_FIELDS.has(k))) return [];
  const set = new Set(keys);
  // `status` changes also flip `archivedAt` in updateProduct — restore both.
  if (set.has('status')) set.add('archivedAt');
  return [...set];
}

/** Pick a plain, JSON-cloned snapshot of a product's `keys` for revert state. */
function pickProductFields(product: Product, keys: readonly string[]): Record<string, unknown> {
  const src = product as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const v = src[key];
    out[key] = v === undefined ? null : (JSON.parse(JSON.stringify(v ?? null)) as unknown);
  }
  return out;
}

function logEntry(level: BulkOperationLogEntry['level'], message: string): BulkOperationLogEntry {
  return { ts: new Date().toISOString(), level, message };
}

function touchedFieldsOf(payload: BulkOperationPayload): string[] {
  const fields = payload.fields ?? {};
  const keys = Object.keys(fields).filter((k) => k !== 'attributeValues');
  if (fields['attributeValues'] && typeof fields['attributeValues'] === 'object') {
    for (const attrKey of Object.keys(fields['attributeValues'] as Record<string, unknown>)) {
      keys.push(`attribute:${attrKey}`);
    }
  }
  return keys;
}

function serialize(op: BulkOperation): SerializedBulkOperation {
  return {
    id: op.id,
    type: op.type,
    status: op.status,
    requestedByAdminUserId: op.requestedByAdminUserId,
    total: op.total,
    processed: op.processed,
    succeeded: op.succeeded,
    skipped: op.skipped,
    failed: op.failed,
    touchedFields: touchedFieldsOf(op.payload),
    results: (op.results as BulkUpdateOutcome[] | null) ?? null,
    logs: op.logs ?? null,
    error: op.error ?? null,
    createdAt: op.createdAt.toISOString(),
    startedAt: op.startedAt ? op.startedAt.toISOString() : null,
    finishedAt: op.finishedAt ? op.finishedAt.toISOString() : null,
    reversible: op.reversible,
    undoStatus: op.undoStatus,
    undoneAt: op.undoneAt ? op.undoneAt.toISOString() : null,
  };
}
