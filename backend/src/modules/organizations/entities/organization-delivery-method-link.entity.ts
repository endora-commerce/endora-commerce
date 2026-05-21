import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * Per-Organization allow-list entry for a delivery method.
 *
 * Empty set ⇒ the platform default methods apply (FR-015). A non-empty
 * set means "only these delivery methods are offered at checkout".
 */
@Entity({ tableName: 'organization_delivery_methods' })
export class OrganizationDeliveryMethodLink {
  [OptionalProps]?: 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  organizationId!: string;

  @PrimaryKey({ type: 'uuid' })
  deliveryMethodId!: string;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();
}
