import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ShoppingListItem — one (product, optional variant, quantity, optional note)
 * row on a ShoppingList. The list itself is the FK target; the FK to
 * `products` is intentionally a plain uuid column (no CASCADE) so a
 * product archive doesn't wipe historical list rows — instead we surface
 * the archived row at conversion time and let the caller skip it.
 */
@GlobalEntity()
@Entity({ tableName: 'shopping_list_items' })
export class ShoppingListItem {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'variantId' | 'note';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  shoppingListId!: string;

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'integer' })
  quantity!: number;

  @Property({ type: 'text', nullable: true })
  note?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
