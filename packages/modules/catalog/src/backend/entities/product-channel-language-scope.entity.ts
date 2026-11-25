import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import type { ProductScopeStatus } from '@endora-commerce/contracts';

/**
 * ProductChannelLanguageScope — feature 163 (`specs/163-product-data-scopes/`
 * data-model.md §2, research R2).
 *
 * The product's status at one (sales channel, language) — the only typed field
 * scoped at channel × language (FR-009). The row's presence is the override:
 * "use inherited" deletes it (FR-012). A row for a language the channel no longer
 * offers stays and is ignored, listed as orphaned (FR-015). Platform-global like
 * `products` (FR-083).
 */
@GlobalEntity()
@Entity({ tableName: 'product_channel_language_scopes' })
export class ProductChannelLanguageScope {
  [OptionalProps]?: 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @PrimaryKey({ type: 'string', length: 16 })
  languageCode!: string;

  /** FR-010 — `inactive` here is plain off, never an archive. */
  @Property({ type: 'string', length: 16 })
  status!: ProductScopeStatus;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
