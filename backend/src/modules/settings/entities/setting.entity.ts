import {
  Collection,
  Entity,
  Enum,
  Index,
  ManyToMany,
  ManyToOne,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { SettingGroup } from './setting-group.entity.js';
import { SalesChannel } from '../../catalog/entities/sales-channel.entity.js';

export const SETTING_VALUE_TYPES = [
  'string',
  'number',
  'boolean',
  'json',
  'string_list',
] as const;
export type SettingValueTypeDb = (typeof SETTING_VALUE_TYPES)[number];

/**
 * Setting — feature 004 / data-model.md.
 *
 * One tunable knob declared by a module. `defaultValue` is the manifest-
 * supplied fallback used by the universal getter when no per-channel
 * `SettingValue` exists for the requested sales channel.
 */
@Entity({ tableName: 'settings' })
export class Setting {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'description';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 160 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  @ManyToOne(() => SettingGroup, { fieldName: 'group_id' })
  @Index()
  group!: SettingGroup;

  @Enum({ items: () => SETTING_VALUE_TYPES, nativeEnumName: 'setting_value_type', fieldName: 'value_type' })
  valueType!: SettingValueTypeDb;

  @Property({ type: 'json', fieldName: 'default_value' })
  defaultValue!: unknown;

  @Property({ type: 'string', length: 120, fieldName: 'owner_module' })
  @Index()
  ownerModule!: string;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  /**
   * Sales-channel scope. Empty collection ⇒ "applies to all sales channels"
   * (FR-004 / R-5). Backed by the `setting_sales_channels` join table.
   */
  @ManyToMany(() => SalesChannel, undefined, {
    pivotTable: 'setting_sales_channels',
    joinColumn: 'setting_id',
    inverseJoinColumn: 'sales_channel_id',
  })
  salesChannels = new Collection<SalesChannel>(this);

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date(), fieldName: 'updated_at' })
  updatedAt: Date = new Date();
}
