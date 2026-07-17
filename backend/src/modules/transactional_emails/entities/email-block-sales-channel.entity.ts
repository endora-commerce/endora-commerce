import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * EmailBlockSalesChannel — feature 047 (US3) bridge. Scopes an email block to a
 * sales channel. No rows for a block => the block is global. `code` is
 * denormalized for per-channel uniqueness (enforced by a unique index).
 */
@GlobalEntity()
@Entity({ tableName: 'email_block_sales_channels' })
export class EmailBlockSalesChannel {
  @PrimaryKey({ type: 'uuid', fieldName: 'block_id' })
  blockId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 180 })
  code!: string;
}
