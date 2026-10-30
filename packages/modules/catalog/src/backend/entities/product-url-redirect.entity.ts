import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * ProductUrlRedirect — feature 163, rewritten by feature 168 (data-model §5,
 * `contracts/url-keys.md` §2–§4). A former key that answers at one (channel, language) with a
 * permanent redirect to the product's effective path there. Unique
 * `(sales_channel_id, language_code, key)`; at most 50 per (product, channel), the oldest
 * dropped by `UrlKeyService`. Constraints are raw SQL in the migration.
 */
@GlobalEntity()
@Entity({ tableName: 'product_url_redirects' })
export class ProductUrlRedirect {
  [OptionalProps]?: 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 16 })
  languageCode!: string;

  @Property({ type: 'string', length: 160 })
  key!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
