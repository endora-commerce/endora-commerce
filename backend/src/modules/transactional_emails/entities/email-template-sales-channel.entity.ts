import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * EmailTemplateSalesChannel — feature 047 (US3) bridge. Scopes an email
 * template to a sales channel. No rows for a template => global.
 */
@GlobalEntity()
@Entity({ tableName: 'email_template_sales_channels' })
export class EmailTemplateSalesChannel {
  @PrimaryKey({ type: 'uuid', fieldName: 'template_id' })
  templateId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 180 })
  code!: string;
}
