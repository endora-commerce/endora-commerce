import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * Per-Organization allow-list entry for a payment method.
 *
 * Empty set ⇒ the platform default methods apply (FR-014). A non-empty
 * set means "only these methods are offered at checkout".
 */
@OrgScoped()
@Entity({ tableName: 'organization_payment_methods' })
export class OrganizationPaymentMethodLink {
  [OptionalProps]?: 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  organizationId!: string;

  @PrimaryKey({ type: 'uuid' })
  paymentMethodId!: string;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
