import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * ComparisonProduct — feature 007 / T012 / data-model.md §1.2.
 *
 * Ordered bridge between a Comparison and the Products it holds.
 * Composite PK on (comparisonId, productId) — a given product appears at
 * most once per comparison. `position` defines column order on the
 * comparison page and PDF; gaps are tolerated when a product is removed
 * mid-session.
 *
 * Both FKs cascade: removing a Product removes it from every Comparison
 * that referenced it (no dangling rows, no orphaned columns); removing a
 * Comparison removes its bridge rows.
 */
@Entity({ tableName: 'comparison_products' })
export class ComparisonProduct {
  [OptionalProps]?: 'addedAt';

  @PrimaryKey({ type: 'uuid' })
  comparisonId!: string;

  @PrimaryKey({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'smallint' })
  position!: number;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  addedAt: Date = new Date();
}
