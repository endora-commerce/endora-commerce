import type { EntityManager } from '@mikro-orm/postgresql';
import { NewsletterSendRecord } from '../entities/newsletter-send-record.entity.js';
import { NewsletterEngagementEvent } from '../entities/newsletter-engagement-event.entity.js';

/**
 * Engagement tracking (feature 048, US6). Records open + click events against a
 * send record and maintains the denormalized counters the stats service reads.
 * Token minting/verification lives in NewsletterTokenHelper; the routes verify
 * the signed token then call these methods with the resolved send-record id.
 */
export class NewsletterTrackingService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async recordOpen(sendRecordId: string): Promise<void> {
    // command-coverage-ignore: engagement telemetry — records an email open,
    // high-volume delivery tracking, not an audited domain-state mutation.
    const em = this.emFactory();
    const record = await em.findOne(NewsletterSendRecord, { id: sendRecordId });
    if (!record) return;
    em.create(NewsletterEngagementEvent, { sendRecordId, type: 'open' });
    if (record.openedAt === null) record.openedAt = new Date();
    await em.flush();
  }

  async recordClick(sendRecordId: string, linkId: string | null, url: string | null): Promise<void> {
    // command-coverage-ignore: engagement telemetry — records a link click,
    // high-volume delivery tracking, not an audited domain-state mutation.
    const em = this.emFactory();
    const record = await em.findOne(NewsletterSendRecord, { id: sendRecordId });
    if (!record) return;
    em.create(NewsletterEngagementEvent, {
      sendRecordId,
      type: 'click',
      linkId,
      url,
    });
    record.clickCount += 1;
    if (record.openedAt === null) record.openedAt = new Date();
    await em.flush();
  }
}
