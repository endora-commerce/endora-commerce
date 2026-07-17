import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * QuickOrderDefaultPreference (feature 039, US2). One row per target — either
 * an Organization or a Customer — holding the four default ordering selections
 * (payment method, delivery method, billing address, shipping address). A
 * customer row overrides the organization row per field; resolution lives in
 * the service. References are plain ids with `ON DELETE SET NULL` FKs (the
 * unique + check + FK constraints are declared in migration 057).
 */
@GlobalEntity()
@Entity({ tableName: 'quick_order_default_preferences' })
@Unique({ properties: ['scope', 'scopeId'] })
export class QuickOrderDefaultPreference {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'defaultPaymentMethodId'
    | 'defaultDeliveryMethodId'
    | 'defaultBillingAddressId'
    | 'defaultShippingAddressId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 16 })
  scope!: 'organization' | 'customer';

  @Property({ type: 'uuid' })
  @Index()
  scopeId!: string;

  @Property({ type: 'uuid', nullable: true })
  defaultPaymentMethodId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  defaultDeliveryMethodId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  defaultBillingAddressId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  defaultShippingAddressId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
