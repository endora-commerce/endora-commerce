import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * One row per Order placed against a credit-limit payment method. Active until
 * the order is paid (releasedReason='invoice_paid') or cancelled
 * (releasedReason='order_cancelled') — both transitions flip status to
 * 'released' and the available amount on the parent CreditLimit grows back.
 */
@GlobalEntity()
@Entity({ tableName: 'credit_limit_reservations' })
export class CreditLimitReservation {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'releasedAt' | 'releasedReason' | 'status';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  creditLimitId!: string;

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  /**
   * The organization that drew the credit — the reserving descendant, which in
   * `independent_default` mode is not the organization the limit row belongs
   * to. Recorded here rather than read back off the order, so the
   * `independent_default` sum is a query over this module's own table (feature
   * 075).
   *
   * Deliberately **not** called `organizationId`, and this entity stays
   * `@GlobalEntity`: the column is a record of who consumed the credit, not the
   * row's tenant key. `@OrgScoped` over it would confine the sums to the
   * ambient tenant, and the `shared_pool` sum has to see the whole subtree —
   * including branches outside the reserving descendant's own scope.
   */
  @Property({ type: 'uuid' })
  @Index()
  reservingOrganizationId!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'active' | 'released' = 'active';

  @Property({ type: 'datetime', nullable: true })
  releasedAt?: Date | null;

  @Property({ type: 'string', length: 32, nullable: true })
  releasedReason?: 'invoice_paid' | 'order_cancelled' | 'admin_revocation' | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
