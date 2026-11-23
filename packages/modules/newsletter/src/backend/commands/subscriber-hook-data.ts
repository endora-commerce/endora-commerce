import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  NewsletterSubscriberHookData,
  NewsletterSubscriberOutbox,
  SubscriberStatus,
} from '@endora-commerce/contracts';
import { NewsletterSubscriberTag } from '../entities/newsletter-subscriber-tag.entity.js';
import type { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';

/**
 * What the subscriber's hookable actions hand a hook (issue #1843), read on the
 * Command's own transaction once its write is flushed. Ids and codes only
 * (`specs/conventions/audit-state.md` list 1): the address, the source and the
 * custom fields stay on the row, where a hook re-reads them through `ctx.em`.
 */
export async function subscriberHookData(
  em: EntityManager,
  subscriber: NewsletterSubscriber,
  previousStatus: SubscriberStatus | null,
): Promise<NewsletterSubscriberHookData> {
  const links = await em.find(NewsletterSubscriberTag, { subscriberId: subscriber.id });
  return {
    subscriberId: subscriber.id,
    status: subscriber.status,
    previousStatus,
    salesChannelId: subscriber.salesChannelId ?? null,
    customerAccountId: subscriber.customerAccountId ?? null,
    organizationId: subscriber.organizationId ?? null,
    tagIds: [...new Set(links.map((link) => link.tagId))].sort(),
  };
}

/** The `afterCommit` row's data: the same ids and codes, copied so the row owns its array. */
export function subscriberOutboxData(data: NewsletterSubscriberHookData): NewsletterSubscriberOutbox {
  return {
    subscriberId: data.subscriberId,
    status: data.status,
    previousStatus: data.previousStatus,
    salesChannelId: data.salesChannelId,
    customerAccountId: data.customerAccountId,
    organizationId: data.organizationId,
    tagIds: [...data.tagIds],
  };
}
