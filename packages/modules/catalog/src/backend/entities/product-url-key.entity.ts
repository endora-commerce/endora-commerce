import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * ProductUrlKey — feature 163, rewritten by feature 168
 * (`specs/168-product-editor-scope-switcher/data-model.md` §5, `contracts/url-keys.md`).
 *
 * A product's URL key at one sales channel (`languageCode` `null` — the Channel key) or at one
 * sales channel × language. The Global key stays `products.slug`. A key text belongs to at most
 * one product per channel across all the channel's languages, orphans included — the exclusion
 * constraint `product_url_keys_one_product_per_channel_key` holds it in the database; the slug
 * and redirect sides are `UrlKeyService.lockAndCheck`'s, the one writer (T149). Constraints are
 * raw SQL in the migration: no `@Unique` here.
 *
 * A row whose channel the product left, or whose language the channel dropped, stays and keeps
 * reserving its key (FR-016, FR-018). Platform-global like `products`.
 */
@GlobalEntity()
@Entity({ tableName: 'product_url_keys' })
export class ProductUrlKey {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'languageCode';

  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  /** `null` = the Channel key; else the Channel × language key, in the channel's spelling. */
  @Property({ type: 'string', length: 16, nullable: true })
  languageCode: string | null = null;

  @Property({ type: 'string', length: 160 })
  key!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
