import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type CrmOpportunityStatusKind = 'open' | 'won' | 'lost';

/**
 * A named state in the configurable Opportunity workflow. `code` is the stable
 * identifier `crm_opportunities.status_code` holds by value; it is immutable
 * after create. `kind` says what the status means for the Opportunity — still
 * worked, or closed as won / lost. At most one row is initial (a partial unique
 * index); the service requires exactly one, and that it is `open`.
 *
 * Platform-wide configuration, as `OrderStatus` is.
 */
@GlobalEntity()
@Entity({ tableName: 'crm_opportunity_statuses' })
export class CrmOpportunityStatus {
  [OptionalProps]?: 'id' | 'name' | 'isInitial' | 'weight' | 'color' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  /** Localized labels, e.g. `{ en: 'New', pl: 'Nowa' }`. */
  @Property({ type: 'json' })
  name: Record<string, string> = {};

  /** Fallback when the viewer's language is missing from `name`. */
  @Property({ type: 'string', length: 120 })
  defaultName!: string;

  @Property({ type: 'string', length: 8 })
  kind!: CrmOpportunityStatusKind;

  @Property({ type: 'boolean' })
  isInitial: boolean = false;

  /** Display order, and the board's column order. */
  @Property({ type: 'integer' })
  weight: number = 100;

  /** Badge colour as a `#rrggbb` hex value. */
  @Property({ type: 'string', length: 16 })
  color: string = '#64748b';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
