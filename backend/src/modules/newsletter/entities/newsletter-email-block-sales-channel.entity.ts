import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/** NewsletterEmailBlockSalesChannel — feature 048. Optional per-channel block scoping. */
@GlobalEntity()
@Entity({ tableName: 'newsletter_email_block_sales_channels' })
export class NewsletterEmailBlockSalesChannel {
  @PrimaryKey({ type: 'uuid', fieldName: 'block_id' })
  blockId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 180 })
  code!: string;
}
