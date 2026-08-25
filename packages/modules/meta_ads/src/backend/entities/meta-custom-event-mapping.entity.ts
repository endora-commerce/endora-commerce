import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { MetaTriggerAction } from '@endora-commerce/contracts';

/**
 * MetaCustomEventMapping (feature 064, US4). Adds a custom Meta event to a
 * storefront action.
 *
 * A mapping is **additive**: the standard Meta event for the action still
 * fires, and this adds another beside it. It never suppresses the standard
 * event — an operator adding an audience event would otherwise silently lose
 * their `Purchase` reporting. This is the one semantic difference from the
 * otherwise-identical `linkedin_conversion_mappings`.
 */
@GlobalEntity()
@Entity({ tableName: 'meta_custom_event_mappings' })
@Index({
  name: 'meta_custom_event_mappings_channel_action_idx',
  properties: ['salesChannelId', 'triggerAction'],
})
export class MetaCustomEventMapping {
  [OptionalProps]?: 'salesChannelId' | 'enabled' | 'version' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId: string | null = null;

  @Property({ type: 'string', length: 32, fieldName: 'trigger_action' })
  triggerAction!: MetaTriggerAction;

  @Property({ type: 'string', length: 64, fieldName: 'event_name' })
  eventName!: string;

  @Property({ type: 'boolean' })
  enabled: boolean = true;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
