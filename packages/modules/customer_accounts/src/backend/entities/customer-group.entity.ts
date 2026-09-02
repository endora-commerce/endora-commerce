import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * CustomerGroup — the segmentation bucket a customer belongs to.
 *
 * A customer account carries one directly (`CustomerAccount.customerGroupId`,
 * a real foreign key into this table with `on delete set null`) and inherits
 * its Organization's (`Organization.customerGroupId`, an indexed column with no
 * constraint) when it has none of its own. Groups have no behavioural state of
 * their own; they exist as an addressable target — for the feature 011
 * Application Rule's `customerGroup` criterion, for a promotion's audience and
 * for a push audience rule.
 *
 * Feature 076 (D-79) moved this class here from `price_lists`. Table ownership
 * resolves from the module directory the decorated class lives in — its
 * `tableName` read out of the entity decorator below — so the move *is* the
 * ownership change; no SQL was written, the creating migration stayed in
 * `price_lists/migrations/`, and the foreign key from `customer_accounts`
 * became intra-module.
 */
@GlobalEntity()
@Entity({ tableName: 'customer_groups' })
export class CustomerGroup {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'description';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'string', length: 1000, nullable: true })
  description?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
