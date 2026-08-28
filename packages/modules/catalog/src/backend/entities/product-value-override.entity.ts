import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ProductValueOverride — feature 022.
 *
 * Stores channel-aware overrides for product attribute values. The
 * global baseline lives on `products.name` / `products.description`
 * (per-language JSONB) and `products.attribute_values` (per-attribute
 * JSONB) — this entity only holds the (channel, [language]) slots.
 *
 * The resolver in `services/product-value-resolver.ts` (and its
 * pure-function twin in `@endora-commerce/contracts`) fuses baseline + overrides
 * into an effective value per (channel, language) context using the
 * fallback chain documented in
 * specs/023-product-scope-editor/data-model.md §3.2.
 *
 * `attributeKey` is a string — for user-defined attributes it matches
 * `product_attributes.key`; for system attributes it is one of the
 * reserved values `'name'` or `'description'` (see
 * services/system-attribute-scopes.ts). There is no FK from
 * `attribute_key` to `product_attributes` because system attributes
 * are not rows there.
 *
 * `languageCode` is NULLABLE — a NULL row models a channel-only
 * override (attribute is channel-scoped but not language-scoped);
 * a non-null row models a channel+language override. Two partial
 * UNIQUE indexes (see migration 043) enforce uniqueness across both
 * shapes.
 */
@GlobalEntity()
@Entity({ tableName: 'product_value_overrides' })
export class ProductValueOverride {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'languageCode';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'string', length: 64 })
  attributeKey!: string;

  @Property({ type: 'uuid' })
  channelId!: string;

  @Property({ type: 'string', length: 16, nullable: true })
  languageCode?: string | null;

  /** Wrapped as `{ v: ... }` so the column is always a JSONB object. */
  @Property({ type: 'json' })
  value!: { v: unknown };

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
