import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Cart — a buyer's in-progress basket. May be:
 *   - authenticated (customerAccountId + organizationId set, anonymousCartToken null)
 *   - anonymous (anonymousCartToken set, the other two null)
 *
 * CartService merges an anonymous cart into the authenticated one at login time
 * (R-09, T125).
 */
@Entity({ tableName: 'carts' })
export class Cart {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'customerAccountId'
    | 'organizationId'
    | 'anonymousCartToken'
    | 'status';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerAccountId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  @Unique()
  anonymousCartToken?: string | null;

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'abandoned' | 'converted' = 'active';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
