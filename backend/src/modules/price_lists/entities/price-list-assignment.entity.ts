import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * PriceListAssignment — links a PriceList to the audience it applies to.
 * Exactly one of `organizationId`, `customerGroupId`, or `isDefault=true`
 * is set per row; the optional `salesChannelId` further scopes the
 * assignment to a single channel.
 *
 * Resolution priority (per assignment, with `priority` as the tiebreaker):
 *   organization-specific > customer-group > default,
 *   sales-channel-specific > channel-agnostic.
 */
@Entity({ tableName: 'price_list_assignments' })
export class PriceListAssignment {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'organizationId'
    | 'customerGroupId'
    | 'salesChannelId'
    | 'isDefault'
    | 'priority';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  priceListId!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerGroupId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  salesChannelId?: string | null;

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  priority: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
