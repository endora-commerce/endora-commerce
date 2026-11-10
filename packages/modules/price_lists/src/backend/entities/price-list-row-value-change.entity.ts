import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * One price row a price-book Command added, changed or removed: a line of a
 * {@link PriceListValueChange} (issue #470, D-288; owner ruling O-3,
 * 2026-11-10). This is what answers "who changed price X from A to B".
 *
 * A line names one price coordinate, the row's selection and quantity window,
 * as `price_list_matrix_entries` stores them, and both sides of its price in
 * the row's own column types (`numeric(14,4)` amounts, `numeric(7,2)`
 * percents), so a recorded price is the stored one and never a rounded copy.
 * A `changed` line kept its coordinate and moved its price. A row whose
 * coordinate moved is one `removed` line and one `added` line. An `added`
 * line has no before side and a `removed` line no after side (CHECKs in the
 * migration). Only rows that differ are recorded, and no row id is kept: a
 * changed row is re-inserted under a new id, so an id is not a coordinate.
 *
 * `priceListId` and `at` are copied from the change so that one b-tree,
 * `(price_list_id, product_id, at desc)`, answers one product's history in a
 * book without a join. The product, variant and category ids reference no
 * catalogue row: the history outlives a catalogue delete, and is read only
 * through its book.
 *
 * **`@RuleScoped()`**, as the book and its rows are; read only by the id of a
 * book already loaded under the caller's price-book scope. The lines go with
 * their change and with their book (`on delete cascade`, owner ruling
 * 2026-11-10).
 */
@RuleScoped()
@Entity({ tableName: 'price_list_row_value_changes' })
export class PriceListRowValueChange {
  [OptionalProps]?:
    | 'variantId'
    | 'productId'
    | 'categoryId'
    | 'attributeKey'
    | 'attributeValue'
    | 'maxQuantity'
    | 'beforePriceType'
    | 'beforeAmount'
    | 'beforePercent'
    | 'afterPriceType'
    | 'afterAmount'
    | 'afterPercent';

  @PrimaryKey({ type: 'uuid' })
  changeId!: string;

  /** The line's position within its change, from 0. */
  @PrimaryKey({ type: 'integer' })
  seq!: number;

  @Property({ type: 'uuid' })
  priceListId!: string;

  /** The change's `at`, copied. */
  @Property({ type: 'datetime' })
  at!: Date;

  @Property({ type: 'string', length: 8 })
  kind!: PriceRowChangeKind;

  @Property({ type: 'uuid', nullable: true })
  variantId: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  productId: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  categoryId: string | null = null;

  @Property({ type: 'string', length: 64, nullable: true })
  attributeKey: string | null = null;

  @Property({ type: 'string', length: 255, nullable: true })
  attributeValue: string | null = null;

  @Property({ type: 'integer' })
  minQuantity!: number;

  @Property({ type: 'integer', nullable: true })
  maxQuantity: number | null = null;

  @Property({ type: 'string', length: 16, nullable: true })
  beforePriceType: PriceRowPriceType | null = null;

  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  beforeAmount: string | null = null;

  @Property({ type: 'decimal', precision: 7, scale: 2, nullable: true })
  beforePercent: string | null = null;

  @Property({ type: 'string', length: 16, nullable: true })
  afterPriceType: PriceRowPriceType | null = null;

  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  afterAmount: string | null = null;

  @Property({ type: 'decimal', precision: 7, scale: 2, nullable: true })
  afterPercent: string | null = null;
}

export type PriceRowChangeKind = 'added' | 'changed' | 'removed';

/** A row's price type, as `price_list_matrix_entries.price_type` holds it. */
export type PriceRowPriceType = 'fixed' | 'percent' | 'amount';
