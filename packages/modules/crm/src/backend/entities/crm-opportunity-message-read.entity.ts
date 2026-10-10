import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';

/**
 * How far one administrator has read the messages of one Opportunity: every
 * message created up to `lastReadAt` is read by them. One row per pair, written
 * when that administrator opens the *Messages* tab, and never moved backwards.
 *
 * It is that person's view of the conversation and nothing about the
 * Opportunity: no Command writes it and the change history never shows it.
 * Scoped through the Opportunity like every other child.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_opportunity_message_reads' })
export class CrmOpportunityMessageRead {
  @PrimaryKey({ type: 'uuid', fieldName: 'opportunity_id' })
  opportunityId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'admin_user_id' })
  adminUserId!: string;

  @Property({ type: 'datetime' })
  lastReadAt!: Date;
}
