import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type {
  FeedItemGranularity,
  FeedOutputFormat,
  FeedProviderCode,
} from '@b2b/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * FeedTemplate — feature 067 / data-model.md §1.
 *
 * A reusable, provider-shaped output definition: the ordered list of fields a
 * feed writes and where each one comes from. Five templates ship as system
 * templates (`isSystem`, addressed by `systemCode` so the lifecycle reconciler
 * can restore a deleted one); everything else is operator-authored.
 *
 * Tenancy: `@GlobalEntity()` — platform-level operator configuration over
 * global catalogue data (data-model §0, Principle XI).
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_templates' })
export class FeedTemplate {
  [OptionalProps]?:
    | 'id'
    | 'providerCode'
    | 'outputFormat'
    | 'itemGranularity'
    | 'isSystem'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** Unique among non-deleted templates. */
  @Property({ type: 'varchar', length: 200, fieldName: 'name' })
  name!: string;

  @Property({ type: 'text', fieldName: 'description', nullable: true })
  description?: string | null;

  /**
   * Drives which taxonomy (if any) the provider-category source resolves
   * against, and which fields the editor marks provider-required.
   */
  @Property({ type: 'varchar', length: 32, fieldName: 'provider_code' })
  @Index()
  providerCode: FeedProviderCode = 'custom';

  @Property({ type: 'varchar', length: 16, fieldName: 'output_format' })
  outputFormat: FeedOutputFormat = 'xml';

  @Property({ type: 'varchar', length: 16, fieldName: 'item_granularity' })
  itemGranularity: FeedItemGranularity = 'product';

  /**
   * The installed provider taxonomy this template's `provider_category` field
   * resolves against (FR-082). Null for providers that publish none.
   * FK to `product_feed_taxonomies.id` — the table lands with Phase 4.
   */
  @Property({ type: 'uuid', fieldName: 'taxonomy_id', nullable: true })
  taxonomyId?: string | null;

  /** Predefined template — every mutation route refuses it (FR-008). */
  @Property({ type: 'boolean', fieldName: 'is_system' })
  isSystem: boolean = false;

  /** Stable id of a predefined template, so the reconciler can restore it. */
  @Property({ type: 'varchar', length: 32, fieldName: 'system_code', nullable: true })
  systemCode?: string | null;

  /** Optimistic concurrency — `If-Match: W/"<id>:<version>"` (FR-076). */
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

  /** Soft delete; a template referenced by a feed cannot be deleted (FR-010). */
  @Property({ type: 'datetime', fieldName: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}
