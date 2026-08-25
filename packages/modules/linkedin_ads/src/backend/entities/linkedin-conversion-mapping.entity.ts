import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { LinkedInTriggerAction } from '@endora-commerce/contracts';

/**
 * LinkedInConversionMapping (feature 063, US3). Binds a storefront action to a
 * LinkedIn conversion rule defined in Campaign Manager.
 *
 * Platform configuration authored by operators and scoped by sales channel, not
 * by organization, so it is a `@GlobalEntity()` — the same classification as
 * `GaCustomEvent`. `sales_channel_id` null means the mapping applies to every
 * channel.
 *
 * Intentionally NOT unique on (channel, action): one action may legitimately
 * report to several conversion rules. The "at most one conversion" rule is per
 * mapping, not per action.
 */
@GlobalEntity()
@Entity({ tableName: 'linkedin_conversion_mappings' })
@Index({
  name: 'linkedin_conversion_mappings_channel_action_idx',
  properties: ['salesChannelId', 'triggerAction'],
})
export class LinkedInConversionMapping {
  [OptionalProps]?:
    | 'salesChannelId'
    | 'conversionRuleUrn'
    | 'enabled'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId: string | null = null;

  @Property({ type: 'string', length: 32, fieldName: 'trigger_action' })
  triggerAction!: LinkedInTriggerAction;

  /** Numeric id from Campaign Manager, kept as text — it is an identifier. */
  @Property({ type: 'string', length: 32, fieldName: 'conversion_id' })
  conversionId!: string;

  /** Null ⇒ derived from `conversionId` at delivery time. */
  @Property({ type: 'string', length: 128, fieldName: 'conversion_rule_urn', nullable: true })
  conversionRuleUrn: string | null = null;

  @Property({ type: 'boolean' })
  enabled: boolean = true;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
