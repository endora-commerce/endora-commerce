import { Entity, Index, PrimaryKey } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/** NewsletterSubscriberTag — feature 048. Bridge subscriber ⇆ tag. */
@GlobalEntity()
@Entity({ tableName: 'newsletter_subscriber_tags' })
@Index({ properties: ['tagId'] })
export class NewsletterSubscriberTag {
  @PrimaryKey({ type: 'uuid', fieldName: 'subscriber_id' })
  subscriberId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'tag_id' })
  tagId!: string;
}
