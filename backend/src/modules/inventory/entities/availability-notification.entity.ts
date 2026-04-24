import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Availability "notify me when in stock" subscription (FR-061).
 * Created by `POST /catalog/products/:id/notify-when-available`; cleared when
 * the availability worker dispatches a notification.
 */
@Entity({ tableName: 'availability_notifications' })
export class AvailabilityNotification {
  [OptionalProps]?: 'id' | 'requestedAt' | 'notifiedAt' | 'variantId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  customerAccountId!: string;

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  requestedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  notifiedAt?: Date | null;
}
