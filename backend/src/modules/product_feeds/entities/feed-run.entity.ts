import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type {
  FeedRunFailureCode,
  FeedRunStatus,
  FeedRunTrigger,
  FeedTemplateField as FeedTemplateFieldDto,
} from '@b2b/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/** Skip reasons for `status = 'skipped'` (data-model §4). */
export type FeedRunSkipReason = 'already_running' | 'feed_disabled';

/**
 * FeedRun — feature 067 / data-model.md §4.
 *
 * One generation attempt, and the anchor for both idempotence and the overlap
 * claim: the claim lives on `product_feeds.current_run_id`, and every terminal
 * transition clears it in the same transaction that sets the status.
 * `heartbeatAt` is refreshed once per batch and is the reaper's only input
 * (FR-036).
 *
 * Tenancy: `@GlobalEntity()` — see `feed-template.entity.ts`.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_runs' })
export class FeedRun {
  [OptionalProps]?:
    | 'id'
    | 'status'
    | 'consideredCount'
    | 'emittedCount'
    | 'skippedCount'
    | 'warningCount'
    | 'issueOverflow'
    | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'product_feed_id' })
  @Index()
  productFeedId!: string;

  @Property({ type: 'varchar', length: 16, fieldName: 'trigger' })
  trigger!: FeedRunTrigger;

  /** Null for a scheduled run — nobody triggered it (FR-060). */
  @Property({ type: 'uuid', fieldName: 'triggered_by_admin_user_id', nullable: true })
  triggeredByAdminUserId?: string | null;

  @Property({ type: 'varchar', length: 24, fieldName: 'status' })
  @Index()
  status: FeedRunStatus = 'queued';

  /**
   * The template's field list as it stood when the run started — FR-076's
   * "an in-flight run completes against the template it started with", and what
   * makes a historical run explicable after the template has moved on.
   */
  @Property({ type: 'json', columnType: 'jsonb', fieldName: 'template_snapshot', nullable: true })
  templateSnapshot?: FeedTemplateFieldDto[] | null;

  @Property({ type: 'datetime', fieldName: 'started_at', nullable: true })
  startedAt?: Date | null;

  @Property({ type: 'datetime', fieldName: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  /** Refreshed each batch; the reaper's input (FR-036). */
  @Property({ type: 'datetime', fieldName: 'heartbeat_at', nullable: true })
  heartbeatAt?: Date | null;

  /** Products the selection matched. */
  @Property({ type: 'integer', fieldName: 'considered_count' })
  consideredCount: number = 0;

  /** Items written. */
  @Property({ type: 'integer', fieldName: 'emitted_count' })
  emittedCount: number = 0;

  @Property({ type: 'integer', fieldName: 'skipped_count' })
  skippedCount: number = 0;

  @Property({ type: 'integer', fieldName: 'warning_count' })
  warningCount: number = 0;

  /** True when issues exceeded the per-run cap (FR-054). */
  @Property({ type: 'boolean', fieldName: 'issue_overflow' })
  issueOverflow: boolean = false;

  @Property({ type: 'varchar', length: 48, fieldName: 'failure_code', nullable: true })
  failureCode?: FeedRunFailureCode | null;

  @Property({ type: 'text', fieldName: 'failure_detail', nullable: true })
  failureDetail?: string | null;

  @Property({ type: 'varchar', length: 48, fieldName: 'skip_reason', nullable: true })
  skipReason?: FeedRunSkipReason | null;

  @Property({ type: 'uuid', fieldName: 'artefact_id', nullable: true })
  artefactId?: string | null;

  @Property({ type: 'integer', fieldName: 'duration_ms', nullable: true })
  durationMs?: number | null;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();
}
