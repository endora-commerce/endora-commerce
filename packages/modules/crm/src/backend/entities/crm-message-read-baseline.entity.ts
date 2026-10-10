import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * One row, one instant: when unread messages started being counted on this
 * installation. An administrator who has no marker for an Opportunity
 * (`CrmOpportunityMessageRead`) has unread only the messages written after it —
 * so the messages that were there before the count existed are nobody's to
 * catch up on. Written once, by the migration; nothing changes it.
 */
@GlobalEntity()
@Entity({ tableName: 'crm_message_read_baselines' })
export class CrmMessageReadBaseline {
  @PrimaryKey({ type: 'smallint' })
  id: number = 1;

  @Property({ type: 'datetime' })
  unreadSince!: Date;
}
