import type { EntityManager } from '@mikro-orm/postgresql';
import type { SelfNewsletterStatus } from '@endora-commerce/contracts';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterTag } from '../entities/newsletter-tag.entity.js';
import { NewsletterSubscriberTag } from '../entities/newsletter-subscriber-tag.entity.js';
import type { NewsletterSubscriberService } from './subscriber.service.js';

/** Customer self-service newsletter view (feature 048, US9). */
export class NewsletterSelfService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly subscribers: NewsletterSubscriberService,
  ) {}

  async getStatus(email: string): Promise<SelfNewsletterStatus> {
    const em = this.emFactory();
    const sub = await em.findOne(NewsletterSubscriber, { email: email.toLowerCase() });
    if (!sub) return { subscribed: false, status: null, tags: [], canManage: true };
    const links = await em.find(NewsletterSubscriberTag, { subscriberId: sub.id });
    const tags = await em.find(NewsletterTag, { id: { $in: links.map((l) => l.tagId) } });
    return {
      subscribed: sub.status === 'active',
      status: sub.status,
      tags: tags.map((t) => ({ code: t.code, name: t.name })),
      canManage: true,
    };
  }

  async subscribe(
    email: string,
    customerAccountId: string,
    tags?: string[],
    customFields?: Record<string, string | number | boolean | null>,
  ): Promise<{ status: 'pending' | 'active' }> {
    return this.subscribers.subscribe({
      email,
      salesChannelId: null,
      source: 'account',
      customerAccountId,
      ...(tags ? { tags } : {}),
      ...(customFields ? { customFields } : {}),
    });
  }

  async unsubscribe(email: string, reason?: string): Promise<{ ok: boolean }> {
    const em = this.emFactory();
    const sub = await em.findOne(NewsletterSubscriber, { email: email.toLowerCase() });
    if (!sub) return { ok: true };
    return this.subscribers.unsubscribe(sub.id, reason);
  }
}
