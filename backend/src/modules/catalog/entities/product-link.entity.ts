import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

export type ProductLinkKind = 'related' | 'up_sell' | 'cross_sell';

/**
 * ProductLink — directed link between two Products (feature 002 US4,
 * data-model.md §2.7). The link `kind` determines where it surfaces:
 *   - `related`  : "Related products" section on PDP
 *   - `up_sell`  : "You might also like" on PDP
 *   - `cross_sell`: "You may also need" on cart
 *
 * DB-level guarantees (migration 022): self-link rejected by CHECK
 * constraint; duplicate (source, target, kind) rejected by UNIQUE; both
 * sides cascade on product delete. Position is admin-curated per
 * (source_product_id, kind).
 */
@Entity({ tableName: 'product_links' })
export class ProductLink {
  [OptionalProps]?: 'id' | 'position' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  sourceProductId!: string;

  @Property({ type: 'uuid' })
  @Index()
  targetProductId!: string;

  @Property({ type: 'string', length: 16 })
  kind!: ProductLinkKind;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
