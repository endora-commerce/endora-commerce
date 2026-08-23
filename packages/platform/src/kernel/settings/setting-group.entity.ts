import {
  Collection,
  Entity,
  Index,
  ManyToMany,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core';
import { GlobalEntity } from '../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';
import { SalesChannel } from '../sales-channels/sales-channel.entity.js';

/**
 * SettingGroup — feature 004 / data-model.md.
 *
 * Logical section under which Settings are listed in Admin UI. The built-in
 * `general` group has `isSystemProtected = true` and is rejected by the
 * service layer when an operator tries to delete it.
 */
@GlobalEntity()
@Entity({ tableName: 'setting_groups' })
export class SettingGroup {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'isSystemProtected';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 120 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'boolean', fieldName: 'is_system_protected' })
  isSystemProtected: boolean = false;

  @Property({ type: 'string', length: 120, fieldName: 'owner_module' })
  @Index()
  ownerModule!: string;

  /**
   * Sales-channel scope. Empty collection ⇒ "applies to all sales channels"
   * (FR-004 / R-5). Backed by the `setting_group_sales_channels` join table.
   */
  @ManyToMany(() => SalesChannel, undefined, {
    pivotTable: 'setting_group_sales_channels',
    joinColumn: 'setting_group_id',
    inverseJoinColumn: 'sales_channel_id',
  })
  salesChannels = new Collection<SalesChannel>(this);

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date(), fieldName: 'updated_at' })
  updatedAt: Date = new Date();
}
