import {
  Entity,
  Index,
  ManyToOne,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { Setting } from './setting.entity.js';
import { SalesChannel } from '../../catalog/entities/sales-channel.entity.js';

/**
 * SettingValue — feature 004 / data-model.md.
 *
 * Per-(setting, sales_channel) admin override. Resolution order from
 * SettingsService: this row's value if present, otherwise the owning
 * Setting's `defaultValue` (R-3).
 *
 * `updatedAt` backs the `If-Match` ETag pattern (R-6 / FR-012); admins must
 * round-trip the timestamp from a prior GET to commit a write.
 */
@Entity({ tableName: 'setting_values' })
@Unique({ properties: ['setting', 'salesChannel'] })
export class SettingValue {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => Setting, { fieldName: 'setting_id' })
  @Index()
  setting!: Setting;

  @ManyToOne(() => SalesChannel, { fieldName: 'sales_channel_id' })
  @Index()
  salesChannel!: SalesChannel;

  @Property({ type: 'json' })
  value!: unknown;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date(), fieldName: 'updated_at' })
  updatedAt: Date = new Date();
}
