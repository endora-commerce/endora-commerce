import type { EntityManager } from '@mikro-orm/postgresql';
import type { BulkUpdateProductsRequest } from '@b2b/contracts';
import { AdminUser } from '../../admin_users/entities/admin-user.entity.js';
import type { AdminNotificationService } from '../../admin_notifications/services/admin-notification-service.js';
import type { Mailer } from '../../email/services/mailer.js';
import {
  BulkOperation,
  type BulkOperationPayload,
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
 *   - `create()` persists a `pending` row and (via the injected kick)
 *     nudges the in-process sweeper so processing starts promptly.
 *   - `processPending()` is the sweep entry point: it drains all
 *     `pending` rows one at a time, applying each through
 *     {@link CatalogBulkUpdateService} with live progress persisted on
 *     the row. A single-flight guard means concurrent ticks (the
 *     interval timer + the create-time kick) never double-process.
 *   - On completion / failure the requester is notified twice: an
 *     in-app bell notification and an email.
 *   - `list()` / `get()` back the "Bulk actions" admin page.
 */

/** Per-product outcomes are capped on the row so a huge run can't bloat it. */
const MAX_PERSISTED_RESULTS = 1000;

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
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
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

export class BulkOperationService {
  /** Single-flight guard so overlapping sweep ticks don't double-process. */
  private draining = false;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly bulkUpdateService: CatalogBulkUpdateService,
    private readonly deps: {
      notificationService?: AdminNotificationService;
      mailer?: Mailer;
      /** Fired after a row is enqueued so the sweeper can start at once. */
      onEnqueued?: () => void;
    } = {},
  ) {}

  async create(input: CreateBulkOperationInput): Promise<SerializedBulkOperation> {
    const em = this.emFactory();
    const op = new BulkOperation();
    op.type = input.type ?? 'product_bulk_update';
    op.status = 'pending';
    op.requestedByAdminUserId = input.requestedByAdminUserId;
    op.total = input.payload.productIds.length;
    op.payload = input.payload;
    await em.persistAndFlush(op);
    this.deps.onEnqueued?.();
    return serialize(op);
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
    const em = this.emFactory();
    const op = await em.findOne(BulkOperation, { id });
    if (!op) return;

    const req: BulkUpdateProductsRequest = {
      productIds: op.payload.productIds,
      fields: op.payload.fields,
    } as BulkUpdateProductsRequest;

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
          finishedAt: new Date(),
        },
      );
      await this.notify(op, 'completed', result.summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await em.nativeUpdate(
        BulkOperation,
        { id },
        { status: 'failed', error: message, finishedAt: new Date() },
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
    const title =
      status === 'completed'
        ? `Bulk edit finished — ${succeeded}/${total} updated`
        : 'Bulk edit failed';
    const body =
      status === 'completed'
        ? `${total} products processed: ${succeeded} succeeded, ${summary?.skipped ?? 0} skipped, ${summary?.failed ?? 0} failed.`
        : `The bulk edit of ${op.total} products could not be completed: ${error ?? 'unknown error'}.`;

    try {
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
    } catch {
      /* notification is best-effort */
    }

    if (this.deps.mailer && admin?.email) {
      try {
        await this.deps.mailer.send({
          messageId: `bulk-op-${op.id}-${status}`,
          to: admin.email,
          subject: title,
          text: `${body}\n\nView the bulk actions page in the admin panel for details.`,
          meta: { bulkOperationId: op.id, status },
        });
      } catch {
        /* email is best-effort */
      }
    }
  }
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
    error: op.error ?? null,
    createdAt: op.createdAt.toISOString(),
    startedAt: op.startedAt ? op.startedAt.toISOString() : null,
    finishedAt: op.finishedAt ? op.finishedAt.toISOString() : null,
  };
}
