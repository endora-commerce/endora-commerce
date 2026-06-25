import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * ReturnCaseComment — feature 046 (US4).
 *
 * A message on a case. Mirrors `order_comments`: admin comments carry a
 * visibility choice (`isCustomerVisible`) and a `notifyCustomer` flag; customer
 * comments are always visible. Exactly one author id is set.
 */
@Entity({ tableName: 'return_case_comments' })
export class ReturnCaseComment {
  [OptionalProps]?:
    | 'id'
    | 'authorAdminUserId'
    | 'authorCustomerAccountId'
    | 'isCustomerVisible'
    | 'notifyCustomer'
    | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  returnCaseId!: string;

  @Property({ type: 'uuid', nullable: true })
  authorAdminUserId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  authorCustomerAccountId?: string | null;

  @Property({ type: 'text' })
  body!: string;

  @Property({ type: 'boolean' })
  isCustomerVisible: boolean = true;

  @Property({ type: 'boolean' })
  notifyCustomer: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();
}
