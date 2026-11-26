import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ReturnCaseComment — feature 046 (US4).
 *
 * A message on a case. Mirrors `order_comments`: admin comments carry a
 * visibility choice (`isCustomerVisible`) and a `notifyCustomer` flag; customer
 * comments are always visible. Exactly one author id is set — or none, on a
 * comment a guest posted through the tracking link (`authorGuest`,
 * `specs/181-guest-complaints/` FR-042), which is always customer-visible.
 */
@GlobalEntity()
@Entity({ tableName: 'return_case_comments' })
export class ReturnCaseComment {
  [OptionalProps]?:
    | 'id'
    | 'authorAdminUserId'
    | 'authorCustomerAccountId'
    | 'isCustomerVisible'
    | 'notifyCustomer'
    | 'authorGuest'
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

  /** Posted by the guest through the tracking link; no author id (`return_case_comments_guest_author_check`). */
  @Property({ type: 'boolean' })
  authorGuest: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();
}
