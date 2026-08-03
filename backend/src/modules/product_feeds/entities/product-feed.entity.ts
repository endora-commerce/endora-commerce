import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type { FeedPricePresentation, ProductSelectionRule } from '@b2b/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * ProductFeed — feature 067 / data-model.md §3.
 *
 * The operator's unit of work: a template bound to one sales channel, language,
 * currency and optional price list, narrowed by a product-selection rule and
 * published at a tokenised URL.
 *
 * Two columns carry more meaning than their type suggests:
 *  - `publishedArtefactId` is THE publish pointer, flipped only once the
 *    generated object is complete (FR-035);
 *  - `currentRunId` is THE overlap claim, taken by the conditional UPDATE in
 *    data-model §5 and cleared by the terminal transition or the reaper. It is
 *    deliberately not a boolean, so the admin can show *which* run holds it.
 *
 * Tenancy: `@GlobalEntity()` — see `feed-template.entity.ts`. FR-061 forbids a
 * feed from ever rendering an organization's negotiated prices, so there is no
 * organization dimension to scope by.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feeds' })
export class ProductFeed {
  [OptionalProps]?:
    | 'id'
    | 'pricePresentation'
    | 'selectionRule'
    | 'enabled'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 200, fieldName: 'name' })
  name!: string;

  /** Used in the download filename; unique. */
  @Property({ type: 'varchar', length: 160, fieldName: 'slug' })
  slug!: string;

  @Property({ type: 'uuid', fieldName: 'feed_template_id' })
  @Index()
  feedTemplateId!: string;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id' })
  @Index()
  salesChannelId!: string;

  @Property({ type: 'varchar', length: 12, fieldName: 'language_code' })
  languageCode!: string;

  /** ISO 4217; validated against the channel's currencies, which live as JSONB. */
  @Property({ type: 'string', length: 3, columnType: 'char(3)', fieldName: 'currency_code' })
  currencyCode!: string;

  /** Null ⇒ the channel/anonymous price resolution (FR-020). */
  @Property({ type: 'uuid', fieldName: 'price_list_id', nullable: true })
  priceListId?: string | null;

  @Property({ type: 'varchar', length: 8, fieldName: 'price_presentation' })
  pricePresentation: FeedPricePresentation = 'gross';

  /** Required when `pricePresentation = 'gross'`; the tax lookup has no buyer to infer from. */
  @Property({ type: 'string', length: 2, columnType: 'char(2)', fieldName: 'tax_country', nullable: true })
  taxCountry?: string | null;

  /** The product-selection AST; `{ kind: 'all' }` is the whole channel catalogue (FR-024). */
  @Property({ type: 'json', columnType: 'jsonb', fieldName: 'selection_rule' })
  selectionRule: ProductSelectionRule = { kind: 'all' };

  /** 5-field cron; null ⇒ manual only (FR-031). */
  @Property({ type: 'varchar', length: 64, fieldName: 'schedule_cron', nullable: true })
  scheduleCron?: string | null;

  /** IANA timezone; required when `scheduleCron` is set. */
  @Property({ type: 'varchar', length: 64, fieldName: 'schedule_timezone', nullable: true })
  scheduleTimezone?: string | null;

  @Property({ type: 'boolean', fieldName: 'enabled' })
  enabled: boolean = true;

  /** SHA-256 hex of the access token; the plaintext is never stored (`api_keys` precedent). */
  @Property({ type: 'string', length: 64, columnType: 'char(64)', fieldName: 'token_hash', nullable: true })
  tokenHash?: string | null;

  /** Non-secret display fragment. */
  @Property({ type: 'varchar', length: 12, fieldName: 'token_prefix', nullable: true })
  tokenPrefix?: string | null;

  @Property({ type: 'datetime', fieldName: 'token_rotated_at', nullable: true })
  tokenRotatedAt?: Date | null;

  /** Non-null ⇒ no public URL (FR-047). */
  @Property({ type: 'datetime', fieldName: 'token_revoked_at', nullable: true })
  tokenRevokedAt?: Date | null;

  /** The publish pointer — flipped only after the object is complete (FR-035). */
  @Property({ type: 'uuid', fieldName: 'published_artefact_id', nullable: true })
  publishedArtefactId?: string | null;

  /** The overlap claim (FR-033, data-model §5). */
  @Property({ type: 'uuid', fieldName: 'current_run_id', nullable: true })
  currentRunId?: string | null;

  @Property({ type: 'uuid', fieldName: 'last_run_id', nullable: true })
  lastRunId?: string | null;

  /** Cached from `queue.getJobSchedulers()`; display only, never authoritative. */
  @Property({ type: 'datetime', fieldName: 'next_run_at', nullable: true })
  nextRunAt?: Date | null;

  /** Rolling average; powers the "run time approaching interval" warning. */
  @Property({ type: 'integer', fieldName: 'avg_run_duration_ms', nullable: true })
  avgRunDurationMs?: number | null;

  @Property({ type: 'integer', fieldName: 'version' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();

  @Property({
    type: 'datetime',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
    fieldName: 'updated_at',
  })
  updatedAt: Date = new Date();
}
