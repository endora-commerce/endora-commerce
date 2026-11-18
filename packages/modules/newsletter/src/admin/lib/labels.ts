import type {
  AutomationStatus,
  AutomationTriggerType,
  CampaignStatus,
  CampaignTargetType,
  CustomFieldType,
  SubscriberStatus,
} from '@endora-commerce/contracts';
import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';

/**
 * The newsletter's enum values as the operator reads them (issue #1463, UX
 * audit CONTENT-05, under the pattern of #1434). Every screen renders a status,
 * an audience or a field type through these maps, never the code the API sends.
 */
export const campaignStatusLabels = defineEnumLabels<CampaignStatus>({
  draft: 'campaign.status.draft',
  scheduled: 'campaign.status.scheduled',
  sending: 'campaign.status.sending',
  sent: 'campaign.status.sent',
  cancelled: 'campaign.status.cancelled',
});

/** In the order the audience select offers them. */
export const campaignTargetLabels = defineEnumLabels<CampaignTargetType>({
  all: 'campaign.target.all',
  tag: 'campaign.target.tag',
  tag_list: 'campaign.target.tag_list',
  group: 'campaign.target.group',
});

export const automationStatusLabels = defineEnumLabels<AutomationStatus>({
  draft: 'automation.status.draft',
  active: 'automation.status.active',
  paused: 'automation.status.paused',
});

export const automationTriggerLabels = defineEnumLabels<AutomationTriggerType>({
  all: 'automation.trigger.all',
  tag: 'automation.trigger.tag',
  tag_list: 'automation.trigger.tag_list',
});

export const subscriberStatusLabels = defineEnumLabels<SubscriberStatus>({
  pending: 'subscriber.status.pending',
  active: 'subscriber.status.active',
  unsubscribed: 'subscriber.status.unsubscribed',
  deactivated: 'subscriber.status.deactivated',
});

export const customFieldTypeLabels = defineEnumLabels<CustomFieldType>({
  text: 'fieldType.text',
  number: 'fieldType.number',
  boolean: 'fieldType.boolean',
  date: 'fieldType.date',
});
