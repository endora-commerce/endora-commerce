import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type {
  FeedTaxonomyCheckOutcome,
  FeedTaxonomyCheckReason,
  FeedTaxonomyCheckTrigger,
  TaxonomyProviderCode,
} from '@b2b/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * FeedTaxonomyCheck — feature 067 / data-model.md §14, FR-093, FR-096.
 *
 * One automated or manual check for a newer provider revision. Append-only: the
 * admin's "last check" line and the notifier's transition test are derived from
 * this table by an indexed read rather than duplicated into a per-provider
 * state row that could disagree with its own history.
 *
 * Every outcome is recorded — `unchanged`, `installed`, `rejected`, `failed` —
 * because "we asked and nothing had changed" is exactly as much of an answer to
 * "is this working?" as an installation is, and an operator who cannot see it
 * has no way to tell a healthy weekly check from a silent one.
 *
 * `installedTaxonomyId` is `ON DELETE SET NULL`, never `CASCADE`: retention
 * purging a superseded revision must not erase the record that it was ever
 * fetched.
 *
 * Tenancy: `@GlobalEntity()` — platform-level operational history over global
 * reference data, like every other entity in this module.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_taxonomy_checks' })
@Index({ properties: ['providerCode', 'startedAt'] })
export class FeedTaxonomyCheck {
  [OptionalProps]?:
    | 'id'
    | 'startedAt'
    | 'finishedAt'
    | 'outcome'
    | 'reason'
    | 'detail'
    | 'httpStatus'
    | 'bytesRead'
    | 'contentHash'
    | 'installedTaxonomyId'
    | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 32, fieldName: 'provider_code' })
  providerCode!: TaxonomyProviderCode;

  /** The same vocabulary `product_feed_runs.trigger` uses. */
  @Property({ type: 'varchar', length: 16, fieldName: 'trigger' })
  trigger!: FeedTaxonomyCheckTrigger;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'started_at' })
  startedAt: Date = new Date();

  /** Null while in flight — also the predicate that refuses an overlapping check (FR-096). */
  @Property({ type: 'datetime', nullable: true, fieldName: 'finished_at' })
  finishedAt: Date | null = null;

  @Property({ type: 'varchar', length: 24, nullable: true, fieldName: 'outcome' })
  outcome: FeedTaxonomyCheckOutcome | null = null;

  @Property({ type: 'varchar', length: 32, nullable: true, fieldName: 'reason' })
  reason: FeedTaxonomyCheckReason | null = null;

  /**
   * One human-readable line — an HTTP status, an error code, node counts.
   * Never a stack trace and never response bytes: this row is rendered to an
   * operator, and a response body from an unknown host is not something to
   * echo back into an admin screen.
   */
  @Property({ type: 'varchar', length: 500, nullable: true, fieldName: 'detail' })
  detail: string | null = null;

  @Property({ type: 'integer', nullable: true, fieldName: 'http_status' })
  httpStatus: number | null = null;

  @Property({ type: 'integer', nullable: true, fieldName: 'bytes_read' })
  bytesRead: number | null = null;

  /** Recorded whatever the outcome — this is what makes "unchanged" auditable. */
  @Property({ type: 'varchar', length: 64, nullable: true, fieldName: 'content_hash' })
  contentHash: string | null = null;

  /** Set only for `outcome = 'installed'`. */
  @Property({ type: 'uuid', nullable: true, fieldName: 'installed_taxonomy_id' })
  installedTaxonomyId: string | null = null;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();
}
