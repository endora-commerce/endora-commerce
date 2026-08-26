import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type {
  FeedDeliveryFailureReason,
  FeedDeliveryProtocol,
  FeedDeliveryStatus,
} from '@endora-commerce/contracts';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * FeedDeliveryAttempt — feature 070 / FR-105, FR-108.
 *
 * One row per attempt, so an operator asked "did the partner get today's file?"
 * can answer it. That question is the whole reason this table exists, which is
 * why a *failed* attempt is recorded as fully as a successful one: an empty
 * history and a history of five failures look identical if only successes are
 * written down.
 *
 * **Nothing here is a credential** (FR-108). `target` is the redacted display
 * form — `sftp://user@host:22/path`, `https://partner.example/ingest` — and
 * `failureDetail` is passed through the same redactor, because a transport
 * library will happily put a password into an error message.
 *
 * `feedRunId` and `feedArtefactId` are nullable because a connection test
 * (FR-106) has neither: it proves reachability and authentication and delivers
 * no artefact, and it is recorded here rather than in a second table so the
 * operator sees one history.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_delivery_attempts' })
export class FeedDeliveryAttempt {
  [OptionalProps]?: 'id' | 'attempt' | 'isTest' | 'startedAt' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'product_feed_id' })
  @Index()
  productFeedId!: string;

  @Property({ type: 'uuid', fieldName: 'feed_run_id', nullable: true })
  feedRunId?: string | null;

  @Property({ type: 'uuid', fieldName: 'feed_artefact_id', nullable: true })
  feedArtefactId?: string | null;

  @Property({ type: 'varchar', length: 16, fieldName: 'protocol' })
  protocol!: FeedDeliveryProtocol;

  /** Redacted display form. Never a password, never a header value. */
  @Property({ type: 'varchar', length: 512, fieldName: 'target' })
  target!: string;

  @Property({ type: 'varchar', length: 16, fieldName: 'status' })
  status!: FeedDeliveryStatus;

  @Property({ type: 'varchar', length: 32, fieldName: 'failure_reason', nullable: true })
  failureReason?: FeedDeliveryFailureReason | null;

  /** The transport's own words, redacted. Bounded so one library cannot flood the table. */
  @Property({ type: 'varchar', length: 2048, fieldName: 'failure_detail', nullable: true })
  failureDetail?: string | null;

  /** 1-based, so "attempt 3 of 5" reads the way an operator counts. */
  @Property({ type: 'integer', fieldName: 'attempt' })
  attempt: number = 1;

  @Property({ type: 'boolean', fieldName: 'is_test' })
  isTest: boolean = false;

  @Property({ type: 'datetime', fieldName: 'started_at' })
  startedAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  @Property({ type: 'integer', fieldName: 'duration_ms', nullable: true })
  durationMs?: number | null;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();
}
