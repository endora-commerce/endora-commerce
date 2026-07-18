import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * BulkOperation — feature: queued product bulk-edit.
 *
 * A persisted record of an asynchronous bulk operation. When an admin
 * selects more than the synchronous threshold of products for a bulk
 * edit, the request is enqueued as one of these rows instead of being
 * applied inline. An in-process sweeper (see `BulkOperationWorker`)
 * picks up `pending` rows, applies the patch through
 * `CatalogBulkUpdateService`, and updates the live counters so the
 * "Bulk actions" admin page can show progress. On completion the
 * requester receives an in-app (bell) notification and an email.
 *
 * `payload` holds the original request (`productIds` + `fields`); on
 * finish, `results` holds the per-product outcome list (capped).
 */
export type BulkOperationStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Undo state of a reversible operation (feature 054, FR-014). */
export type BulkOperationUndoStatus = 'none' | 'reverted' | 'partially_reverted';

export interface BulkOperationPayload {
  productIds: string[];
  fields: Record<string, unknown>;
}

/**
 * One affected record's captured pre/post state for undo (feature 054, §R3/§R5).
 * `before` is the minimal changed-field values to restore; `after` is what the
 * operation wrote, compared against current state to detect conflicts.
 */
export interface BulkOperationRevertRecord {
  recordId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * One timestamped lifecycle event in a bulk operation's log trail. The list
 * grows as the operation moves through its lifecycle (created → started →
 * completed/failed, plus notable milestones), giving the detail view a
 * "what happened, when" record alongside the per-element `results`.
 */
export interface BulkOperationLogEntry {
  /** ISO-8601 timestamp of the event. */
  ts: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

@GlobalEntity()
@Entity({ tableName: 'catalog_bulk_operations' })
export class BulkOperation {
  [OptionalProps]?:
    | 'id'
    | 'type'
    | 'status'
    | 'processed'
    | 'succeeded'
    | 'skipped'
    | 'failed'
    | 'results'
    | 'logs'
    | 'error'
    | 'createdAt'
    | 'startedAt'
    | 'finishedAt'
    | 'reversible'
    | 'undoStatus';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  type: string = 'product_bulk_update';

  @Property({ type: 'string', length: 16 })
  @Index()
  status: BulkOperationStatus = 'pending';

  @Property({ type: 'uuid' })
  @Index()
  requestedByAdminUserId!: string;

  @Property({ type: 'integer' })
  total!: number;

  @Property({ type: 'integer' })
  processed = 0;

  @Property({ type: 'integer' })
  succeeded = 0;

  @Property({ type: 'integer' })
  skipped = 0;

  @Property({ type: 'integer' })
  failed = 0;

  /** The original request payload — `{ productIds, fields }`. */
  @Property({ type: 'json' })
  payload!: BulkOperationPayload;

  /** Per-product outcomes once finished (capped to keep the row small). */
  @Property({ type: 'json', nullable: true })
  results?: unknown | null;

  /** Ordered lifecycle log entries (see {@link BulkOperationLogEntry}). */
  @Property({ type: 'json', nullable: true })
  logs?: BulkOperationLogEntry[] | null;

  @Property({ type: 'text', nullable: true })
  error?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  startedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  finishedAt?: Date | null;

  // ---- Feature 054 — reversible bulk operations (US2) --------------------

  /** Per-record before/after snapshot captured for undo. Null ⇒ nothing to revert. */
  @Property({ type: 'json', nullable: true })
  revertState?: BulkOperationRevertRecord[] | null;

  /** Whether this operation captured revert data and may be undone (FR-004). */
  @Property({ type: 'boolean' })
  reversible = false;

  /** Undo progress: `none` until undone, then `reverted` / `partially_reverted` (FR-014). */
  @Property({ type: 'string', length: 16 })
  undoStatus: BulkOperationUndoStatus = 'none';

  /** When the undo completed. */
  @Property({ type: 'datetime', nullable: true })
  undoneAt?: Date | null;

  /** Links the undo's own audited action back to this operation (FR-007). */
  @Property({ type: 'uuid', nullable: true })
  undoOperationId?: string | null;
}
