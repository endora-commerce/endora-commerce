import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';
import type { GaCustomEventField, GaTriggerAction } from '@b2b/contracts';

/**
 * GaCustomEvent (feature 049, US3). Maps a storefront trigger action to a named
 * GA4 event with a selected list of payload fields.
 *
 * The selected fields are a small, ordered, always-loaded-with-the-event list
 * that is never queried independently, so they are stored inline as a JSONB
 * column rather than a second table (Principle IV — the boundary Zod schema
 * already enforces the static-field-set and uniqueness rules). `sales_channel_id`
 * null means the event applies to all channels.
 */
@GlobalEntity()
@Entity({ tableName: 'ga_custom_events' })
@Index({ name: 'ga_custom_events_channel_action_idx', properties: ['salesChannelId', 'triggerAction'] })
export class GaCustomEvent {
  [OptionalProps]?:
    | 'salesChannelId'
    | 'buttonId'
    | 'enabled'
    | 'fields'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId: string | null = null;

  @Property({ type: 'string', length: 40, fieldName: 'event_name' })
  eventName!: string;

  @Property({ type: 'string', length: 32, fieldName: 'trigger_action' })
  triggerAction!: GaTriggerAction;

  @Property({ type: 'string', length: 128, fieldName: 'button_id', nullable: true })
  buttonId: string | null = null;

  @Property({ type: 'boolean' })
  enabled: boolean = true;

  @Property({ type: 'json' })
  fields: GaCustomEventField[] = [];

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
