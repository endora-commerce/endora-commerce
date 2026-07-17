import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * MegamenuBinding — composite-key entity (megamenuId, salesChannelId,
 * language). `active` is the flag the partial unique index
 * `idx_megamenu_bindings_active_uniq` enforces — exactly one active
 * binding per (sales_channel_id, language) pair (FR-008 / R3).
 */
@GlobalEntity()
@Entity({ tableName: 'megamenu_bindings' })
export class MegamenuBinding {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'active' | 'version';

  @PrimaryKey({ type: 'uuid', fieldName: 'megamenu_id' })
  megamenuId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  @PrimaryKey({ type: 'string', length: 8 })
  language!: string;

  @Property({ type: 'boolean' })
  active: boolean = false;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
