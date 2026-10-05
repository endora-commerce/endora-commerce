import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { CrmDocumentKind } from './crm-value-counting-status.entity.js';

export type CrmOpportunityLinkSource =
  | 'manual'
  | 'auto'
  | 'created_from_opportunity'
  | 'quote_conversion';

/**
 * A link from an Opportunity to an Order or a Quote Request. `documentId` is
 * the document's id by value — the column is polymorphic, so there is no
 * foreign key, and integrity is the owner's read port at link time.
 *
 * Unique on `(documentKind, documentId)`: a document belongs to at most one
 * Opportunity, which is what gives "which Opportunity does this Order move?"
 * one answer and makes automatic creation idempotent.
 *
 * Never loaded by its own id alone: load the Opportunity through the scoped
 * EntityManager first, then the link by `(opportunityId, id)`.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_opportunity_links' })
@Unique({ properties: ['documentKind', 'documentId'] })
export class CrmOpportunityLink {
  [OptionalProps]?: 'id' | 'syncStatus' | 'linkedByAdminUserId' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  opportunityId!: string;

  @Property({ type: 'string', length: 16 })
  documentKind!: CrmDocumentKind;

  @Property({ type: 'uuid' })
  documentId!: string;

  /** Whether the document follows the Opportunity's status; ignored for quote requests. */
  @Property({ type: 'boolean' })
  syncStatus: boolean = true;

  @Property({ type: 'string', length: 24 })
  linkSource!: CrmOpportunityLinkSource;

  @Property({ type: 'uuid', nullable: true })
  linkedByAdminUserId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
