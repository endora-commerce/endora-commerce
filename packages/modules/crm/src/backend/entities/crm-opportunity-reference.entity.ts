import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type CrmReferenceSourceKind = 'description' | 'comment';
export type CrmReferenceTargetType = 'product' | 'order' | 'admin_user';

/**
 * A Product, an Order or a person mentioned in an Opportunity's description or
 * in one of its comments. Derived data: the rows of one source are replaced wholesale
 * whenever that source's text is saved. `targetId` is held by value; a target
 * that is gone or not visible to the reader renders as unavailable.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_opportunity_references' })
@Index({ properties: ['targetType', 'targetId'] })
export class CrmOpportunityReference {
  [OptionalProps]?: 'id' | 'sourceId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  opportunityId!: string;

  @Property({ type: 'string', length: 16 })
  sourceKind!: CrmReferenceSourceKind;

  /** The comment's id; `null` for the description. */
  @Property({ type: 'uuid', nullable: true })
  sourceId?: string | null;

  @Property({ type: 'string', length: 16 })
  targetType!: CrmReferenceTargetType;

  @Property({ type: 'uuid' })
  targetId!: string;
}
