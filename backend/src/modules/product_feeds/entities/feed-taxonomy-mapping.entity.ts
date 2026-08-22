import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type { TaxonomyProviderCode } from '@endora-commerce/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * FeedTaxonomyMapping — feature 067 / data-model.md §10.
 *
 * The operator's decision: this shop category means that provider node.
 *
 * **Scope is one installation-wide set per provider taxonomy** (FR-081) — not
 * per feed, not per template, no organization column, no channel column. A shop
 * category means the same thing in Google's taxonomy whichever campaign
 * advertises it, and per-feed copies would drift across languages and channels.
 * It labels a category; it never decides visibility, which is why it sits
 * comfortably in the module's all-global tenant classification.
 *
 * `taxonomyProviderCode` is deliberately **not** a foreign key to a taxonomy
 * *revision*: a mapping has to survive a revision install (FR-085). When a newer
 * revision no longer contains the node, the row is **kept** and flagged
 * `stale` — never rewritten, never deleted, never silently remapped.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_taxonomy_mappings' })
export class FeedTaxonomyMapping {
  [OptionalProps]?: 'id' | 'stale' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 32, fieldName: 'taxonomy_provider_code' })
  @Index()
  taxonomyProviderCode!: TaxonomyProviderCode;

  @Property({ type: 'uuid', fieldName: 'category_id' })
  categoryId!: string;

  @Property({ type: 'varchar', length: 32, fieldName: 'node_external_id' })
  nodeExternalId!: string;

  /** The mapped node vanished in the installed revision; the row is kept (FR-085). */
  @Property({ type: 'boolean', fieldName: 'stale' })
  stale: boolean = false;

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
