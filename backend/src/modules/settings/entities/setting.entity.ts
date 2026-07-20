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
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';
import { SettingGroup } from './setting-group.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';

export const SETTING_VALUE_TYPES = [
  'string',
  'number',
  'boolean',
  'json',
  'string_list',
  'secret',
] as const;
export type SettingValueTypeDb = (typeof SETTING_VALUE_TYPES)[number];

/**
 * Setting — feature 004 / data-model.md.
 *
 * One tunable knob declared by a module. `defaultValue` is the manifest-
 * supplied fallback used by the universal getter when no per-channel
 * `SettingValue` exists for the requested sales channel.
 */
@GlobalEntity()
@Entity({ tableName: 'settings' })
export class Setting {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'description'
    | 'globalValue'
    | 'enumOptions'
    | 'hidden';

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
   * Platform-wide "global override" the admin has set. NULL means no global
   * override — the resolver falls back to `defaultValue`. Per-channel
   * `SettingValue` rows take precedence over this for their channel.
   */
  @Property({ type: 'json', nullable: true, fieldName: 'global_value' })
  globalValue?: unknown | null;

  /**
   * Closed list of allowed values for an enum-style `string` setting (manifest
   * `enumOptions`). NULL ⇒ ordinary free-text setting. When set, the admin
   * renders a dropdown and value writes are constrained to these options.
   */
  @Property({ type: 'json', nullable: true, fieldName: 'enum_options' })
  enumOptions?: string[] | null;

  /**
   * When true, the setting is excluded from the generic admin Settings screen
   * and managed exclusively through its owning module's dedicated UI (e.g. the
   * PWA settings page). It stays fully readable/writable by code. Manifest-
   * driven config, kept in sync on every reconciliation.
   */
  @Property({ type: 'boolean', default: false })
  hidden: boolean = false;

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
