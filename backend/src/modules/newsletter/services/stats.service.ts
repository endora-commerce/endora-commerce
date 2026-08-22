import type { EntityManager } from '@mikro-orm/postgresql';
import type { CampaignStats } from '@endora-commerce/contracts';
import { NewsletterSendRecord } from '../entities/newsletter-send-record.entity.js';
import { NewsletterEngagementEvent } from '../entities/newsletter-engagement-event.entity.js';

function rate(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 1000 : 0;
}

/** Campaign / automation engagement statistics (feature 048, US6). */
export class NewsletterStatsService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async campaignStats(campaignId: string): Promise<CampaignStats> {
    const em = this.emFactory();
    const records = await em.find(NewsletterSendRecord, { campaignId });
    const sent = records.filter((r) => r.status === 'sent').length;
    const failed = records.filter((r) => r.status === 'failed' || r.status === 'bounced' || r.status === 'complained').length;
    const opened = records.filter((r) => r.openedAt !== null).length;
    const clicked = records.filter((r) => r.clickCount > 0).length;

    const recordIds = records.map((r) => r.id);
    const perLinkClicks = recordIds.length > 0 ? await this.perLink(em, recordIds) : [];

    return {
      sent,
      delivered: sent,
      failed,
      opened,
      clicked,
      openRate: rate(opened, sent),
      clickRate: rate(clicked, sent),
      perLinkClicks,
    };
  }

  private async perLink(
    em: EntityManager,
    recordIds: string[],
  ): Promise<Array<{ url: string; clicks: number }>> {
    const events = await em.find(NewsletterEngagementEvent, {
      sendRecordId: { $in: recordIds },
      type: 'click',
    });
    const counts = new Map<string, number>();
    for (const e of events) {
      const url = e.url ?? '';
      counts.set(url, (counts.get(url) ?? 0) + 1);
    }
    return [...counts.entries()].map(([url, clicks]) => ({ url, clicks }));
  }
}
