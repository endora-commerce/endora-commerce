import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * ProductPackagingUnit — feature 043. A named ordering unit attached to a
 * product, e.g. "Paleta" = 480 pieces. Operators manage these in the
 * Inventory section of the admin product card; the storefront surfaces them
 * so a buyer can order by the unit (which adds `baseQuantity × units` pieces
 * to the cart, labelled with the unit name).
 *
 * Lines (cart/order/RFQ) snapshot their own copy of the name + base quantity
 * at creation, so deleting or editing a unit never alters historical
 * documents — a plain hard delete is therefore safe (no soft-delete column).
 */
@Entity({ tableName: 'product_packaging_units' })
@Unique({ properties: ['productId', 'name'] })
export class ProductPackagingUnit {
  [OptionalProps]?: 'id' | 'position' | 'isDefault' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  /** Number of base pieces this unit contains. Always >= 1. */
  @Property({ type: 'integer' })
  baseQuantity!: number;

  @Property({ type: 'integer' })
  position: number = 0;

  /** Whether this unit is the one presented by default on the storefront. */
  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
