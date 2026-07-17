import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * CustomerGroup — a named bucket of Organizations sharing pricing rules.
 * An Organization belongs to at most one group via
 * `Organization.customerGroupId`. Groups have no behavioural state of
 * their own; they exist as an addressable target for the feature 011
 * Application Rule's `customerGroup` criterion.
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
