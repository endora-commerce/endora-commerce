import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type { FeedRunIssueReason } from '@b2b/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

export type FeedRunIssueSeverity = 'skip' | 'warning';

/**
 * FeedRunIssue — feature 067 / data-model.md §6.
 *
 * A per-item skip or warning record: why one product was left out of a run, or
 * what was imperfect about it. Writes stop at the settings-driven per-run cap
 * and set `product_feed_runs.issue_overflow`; the complete list ships as a
 * second, small artefact (FR-054).
 *
 * `productId` and `variantId` deliberately carry **no** foreign key: run
 * history must survive product deletion, in the same spirit as the SKU
 * snapshots on order lines.
 *
 * Tenancy: `@GlobalEntity()` — see `feed-template.entity.ts`.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_run_issues' })
export class FeedRunIssue {
  [OptionalProps]?: 'id' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'feed_run_id' })
  @Index()
  feedRunId!: string;

  @Property({ type: 'varchar', length: 8, fieldName: 'severity' })
  severity!: FeedRunIssueSeverity;

  @Property({ type: 'varchar', length: 48, fieldName: 'reason' })
  reason!: FeedRunIssueReason;

  /** Historical record, not a reference — see the class comment. */
  @Property({ type: 'uuid', fieldName: 'product_id', nullable: true })
  productId?: string | null;

  /** Historical record, not a reference — see the class comment. */
  @Property({ type: 'uuid', fieldName: 'variant_id', nullable: true })
  variantId?: string | null;

  /** Snapshot, so the issue stays readable after a rename. */
  @Property({ type: 'varchar', length: 255, fieldName: 'sku', nullable: true })
  sku?: string | null;

  /** The offending template field, when the reason is field-specific. */
  @Property({ type: 'varchar', length: 128, fieldName: 'output_name', nullable: true })
  outputName?: string | null;

  @Property({ type: 'varchar', length: 255, fieldName: 'detail', nullable: true })
  detail?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();
}
