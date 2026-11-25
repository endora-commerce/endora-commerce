import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * CmsBrandTokens — one complete brand-token set per scope
 * (`specs/163-page-builder-marketing-pages/` data-model §1.3).
 *
 * `salesChannelId` is null for the global row and names a channel for its
 * override; at most one row per scope, the global row included. `tokens` is a
 * whole `CmsBrandTokens` object, validated by `cmsBrandTokensSchema` at the
 * write route. Written only by the `cms.brand_tokens.update` Command, through
 * `CmsBrandTokensService`. Platform content, not tenant-scoped.
 */
@GlobalEntity()
@Entity({ tableName: 'cms_brand_tokens' })
export class CmsBrandTokens {
  [OptionalProps]?: 'id' | 'salesChannelId' | 'version' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Unique({ name: 'cms_brand_tokens_sales_channel_id_unique' })
  salesChannelId?: string | null;

  @Property({ type: 'json' })
  tokens!: Record<string, unknown>;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
