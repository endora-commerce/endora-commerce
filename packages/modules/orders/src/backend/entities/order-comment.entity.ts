import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * OrderComment — feature 038 (US5).
 *
 * A note attached to an order, authored either by an admin/sales rep or by the
 * customer. Admin authors may set `isCustomerVisible` and `notifyCustomer`;
 * customer-authored comments are always customer-visible and never notify
 * (enforced in the service, not here). Comments are allowed only while the
 * order is non-terminal.
 */
@GlobalEntity()
@Entity({ tableName: 'order_comments' })
export class OrderComment {
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
  orderId!: string;

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
