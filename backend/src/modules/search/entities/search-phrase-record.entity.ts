import {
  Entity,
  Index,
  ManyToOne,
  OptionalProps,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';

/**
 * SearchPhraseRecord — feature 006 / US3 / data-model.md §1.1.
 *
 * One row per committed search (Enter / "Search" action). Append-only
 * dataset consumed by the future Analytics module to surface popular
 * phrases, dead-end phrases, and frequency trends.
 *
 * Storage rules:
 *   - `phrase` is verbatim — no typo correction or LLM expansion (FR-013).
 *   - `phrase_normalized` is `lower(trim(phrase))`, maintained at insert
 *     time; supports case-insensitive aggregation without rewriting the
 *     verbatim phrase.
 *   - `result_count` reflects the size of the result set the customer
 *     actually saw; `0` is recorded for dead-end phrases (FR-014).
 *   - FK to `sales_channels.id` is RESTRICT, not CASCADE: removing a
 *     sales channel must surface as a manual decision, not silently
 *     delete history.
 *
 * Threshold no-op: callers (the `/api/v1/search/record` route + the
 * SearchPhraseRecorder service) refuse to insert when the trimmed
 * phrase length is below the channel's `search.popup.minimum_query_length`
 * setting. The threshold check is the recorder's job, not the entity's.
 */
@GlobalEntity()
@Entity({ tableName: 'search_phrase_records' })
export class SearchPhraseRecord {
  [OptionalProps]?: 'id' | 'recordedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 512 })
  phrase!: string;

  /**
   * `lower(trim(phrase))` — populated by the recorder service before
   * persistAndFlush. Indexed by `(sales_channel_id, phrase_normalized,
   * recorded_at DESC)` for the analytics aggregation query.
   */
  @Property({ type: 'string', length: 512, fieldName: 'phrase_normalized' })
  phraseNormalized!: string;

  @ManyToOne(() => SalesChannel, { fieldName: 'sales_channel_id' })
  @Index()
  salesChannel!: SalesChannel;

  @Property({ type: 'integer', fieldName: 'result_count' })
  resultCount!: number;

  @Property({
    type: 'datetime',
    onCreate: () => new Date(),
    fieldName: 'recorded_at',
  })
  recordedAt: Date = new Date();
}
