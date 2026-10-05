import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A file attached to an Opportunity. The bytes live in the media library;
 * this row is the link. `assetId` is held by value, and the library is told
 * about the reference through its registry so it refuses to delete a file an
 * Opportunity uses. `fileName` is a snapshot taken at attach time.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_opportunity_attachments' })
@Unique({ properties: ['opportunityId', 'assetId'] })
export class CrmOpportunityAttachment {
  [OptionalProps]?: 'id' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  opportunityId!: string;

  @Property({ type: 'uuid' })
  @Index()
  assetId!: string;

  @Property({ type: 'string', length: 255 })
  fileName!: string;

  @Property({ type: 'uuid' })
  uploadedByAdminUserId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
