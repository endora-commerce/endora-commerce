import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type { TaxonomyProviderCode } from '@b2b/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * FeedTaxonomy — feature 067 / data-model.md §8.
 *
 * One bundled provider taxonomy at one revision. The rows are installed by the
 * module's lifecycle reconciler from files that ship inside the module
 * (`data/taxonomies/<provider>/<revision>/{en,pl}.txt`); **nothing fetches them
 * at runtime** (FR-077), which is what keeps feed output independent of a third
 * party's uptime and keeps air-gapped installations working.
 *
 * Installing a newer revision is a platform upgrade, not an operator action, so
 * there is deliberately no route that installs, uploads or refreshes one.
 *
 * Tenancy: `@GlobalEntity()` — reference data, no tenant dimension.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_taxonomies' })
export class FeedTaxonomy {
  [OptionalProps]?: 'id' | 'isCurrent' | 'nodeCount' | 'installedAt' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 32, fieldName: 'provider_code' })
  @Index()
  providerCode!: TaxonomyProviderCode;

  /** The provider's own published revision label, e.g. `2021-09-21`. */
  @Property({ type: 'varchar', length: 32, fieldName: 'revision' })
  revision!: string;

  /** Exactly one per `providerCode`, enforced by a partial unique index. */
  @Property({ type: 'boolean', fieldName: 'is_current' })
  isCurrent: boolean = false;

  @Property({ type: 'integer', fieldName: 'node_count' })
  nodeCount: number = 0;

  /** Shown in the admin so an operator can see which revision they are mapping against (FR-078). */
  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'installed_at' })
  installedAt: Date = new Date();

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();
}
