import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { OrderCommentSystemNote } from '@endora-commerce/contracts';

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
    | 'systemNote'
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

  /**
   * Present ⇒ an author-less **system note** the platform wrote
   * (`specs/162-custom-fields-value-carry/`, data-model §2): both authors
   * `null`, never customer-visible, never notifying, and `body` an English
   * fallback of what the note says. Never listed to the buyer.
   */
  @Property({ type: 'json', nullable: true })
  systemNote?: OrderCommentSystemNote | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();
}
