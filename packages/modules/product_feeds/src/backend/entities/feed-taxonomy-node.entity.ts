import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * FeedTaxonomyNode — feature 067 / data-model.md §9.
 *
 * One entry of a provider taxonomy, ~5 600 for Google and ~4 500 for Meta.
 *
 * **Labels are a per-language JSONB map on one row per node**, not one row per
 * (node, language). That halves the row count, and — the reason it was chosen —
 * it makes "switch the admin language and the stored mapping is unchanged"
 * (FR-085) true by construction rather than by care: a mapping stores
 * `externalId`, which has no language dimension to drift along.
 *
 * Tenancy: `@GlobalEntity()` — reference data.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_taxonomy_nodes' })
export class FeedTaxonomyNode {
  [OptionalProps]?: 'id' | 'label' | 'fullPath' | 'depth' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'taxonomy_id' })
  @Index()
  taxonomyId!: string;

  /** The provider's own stable node id — **what a mapping stores** (FR-085). */
  @Property({ type: 'varchar', length: 32, fieldName: 'external_id' })
  externalId!: string;

  /** Tree edge, by external id rather than by row id, so a reload keeps it valid. */
  @Property({ type: 'varchar', length: 32, fieldName: 'parent_external_id', nullable: true })
  parentExternalId?: string | null;

  /** `{"en":"Chairs","pl":"Krzesła"}`. */
  @Property({ type: 'json', columnType: 'jsonb', fieldName: 'label' })
  label: Record<string, string> = {};

  /** `{"en":"Furniture > Chairs"}` — precomputed for search and for display. */
  @Property({ type: 'json', columnType: 'jsonb', fieldName: 'full_path' })
  fullPath: Record<string, string> = {};

  @Property({ type: 'integer', fieldName: 'depth' })
  depth: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();
}
