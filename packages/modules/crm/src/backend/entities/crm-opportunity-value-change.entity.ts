import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * What one Command changed among an Opportunity's values, with the values
 * (issue #470, D-288; `specs/conventions/audit-state.md` §3).
 *
 * The platform audit log is not tenant-scoped, so a `crm.opportunity.*` entry
 * names the fields a write changed (`changedFields`, `changedCustomFields`) and
 * carries this row's id as `valueChangeId`; the Opportunity's change history
 * serves the values from here. Written in the Command of the change, so the
 * row and the audit entry commit or roll back together. Scoped through the
 * Opportunity like every other child, and read only by the id of an
 * Opportunity that was loaded through the scoped EntityManager.
 *
 * `before` is `null` for something that only arrived (a creation, an added
 * Event), `after` for something that went (a removed Event or attachment).
 * Each side holds only the keys that changed.
 */
@TransitivelyScoped('CrmOpportunity', 'opportunityId')
@Entity({ tableName: 'crm_opportunity_value_changes' })
export class CrmOpportunityValueChange {
  [OptionalProps]?: 'id' | 'before' | 'after' | 'at';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  opportunityId!: string;

  @Property({ type: 'json', nullable: true })
  before?: CrmOpportunityValueState | null = null;

  @Property({ type: 'json', nullable: true })
  after?: CrmOpportunityValueState | null = null;

  @Property({ type: 'datetime' })
  at: Date = new Date();
}

/** The changed values of one side of a write — only the keys that changed. */
export type CrmOpportunityValueState = Record<string, unknown>;
