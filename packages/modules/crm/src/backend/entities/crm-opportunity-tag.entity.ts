import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';

/**
 * The join between an Opportunity and a tag — a composite key, cascading from
 * both sides. Scoped through the Opportunity: which tags an Opportunity carries
 * is that Organization's information, even though the tag itself is global.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_opportunity_tags' })
export class CrmOpportunityTag {
  [OptionalProps]?: 'createdAt';

  @PrimaryKey({ type: 'uuid', fieldName: 'opportunity_id' })
  opportunityId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'tag_id' })
  @Index()
  tagId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
