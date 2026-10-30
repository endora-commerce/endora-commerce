import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ProductPackagingUnitScopeOverride — feature 168 (`specs/168-product-editor-scope-switcher/data-model.md` §7).
 *
 * One override of one field of a packaging unit at a Channel (`languageCode` `null`) or Channel × language
 * scope. The row's **presence** is the override; `value` is `{ "v": <value> }`, and `{ "v": null }`
 * is an empty override (FR-013). No row = inherit. Fields: `name` (text or empty).
 *
 * `productId` is denormalised for the per-product read, and the subject is referenced by a
 * **composite** FK `(packaging_unit_id, product_id)` so an override can never point at another product's
 * subject (R22). Partial uniques, type CHECKs and indexes are raw SQL in the migration: no
 * `@Unique` here. Platform-global like `products`.
 */
@GlobalEntity()
@Entity({ tableName: 'product_packaging_unit_scope_overrides' })
export class ProductPackagingUnitScopeOverride {
  [OptionalProps]?: 'id' | 'languageCode' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'packaging_unit_id' })
  packagingUnitId!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  /** `null` = the Channel scope; else Channel × language, in the channel's spelling. */
  @Property({ type: 'string', length: 16, nullable: true })
  languageCode: string | null = null;

  @Property({ type: 'string', length: 16 })
  field!: 'name';

  /** `{ "v": <value> }`; `{ "v": null }` = empty override. */
  @Property({ type: 'json' })
  value!: { v: unknown };

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
