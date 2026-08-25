import { Entity, PrimaryKey } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/** NewsletterCampaignSubscriber — feature 048. Bridge for `target_type = group`. */
@GlobalEntity()
@Entity({ tableName: 'newsletter_campaign_subscribers' })
export class NewsletterCampaignSubscriber {
  @PrimaryKey({ type: 'uuid', fieldName: 'campaign_id' })
  campaignId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'subscriber_id' })
  subscriberId!: string;
}
