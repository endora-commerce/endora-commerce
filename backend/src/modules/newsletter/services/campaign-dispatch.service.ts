import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { NewsletterSendProvider } from '@b2b/contracts';
import { NewsletterCampaign } from '../entities/newsletter-campaign.entity.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSendRecord } from '../entities/newsletter-send-record.entity.js';
import type { NewsletterAudienceResolver } from './audience-resolver.js';
import type { NewsletterContentService } from './content.service.js';
import type { NewsletterOptInService } from './opt-in.service.js';
import type { NewsletterLinkBuilder } from './subscriber.service.js';

export interface CampaignDispatchDeps {
  emFactory: () => EntityManager;
  audience: NewsletterAudienceResolver;
  content: NewsletterContentService;
  optIn: NewsletterOptInService;
  links: NewsletterLinkBuilder;
  /** Resolves the active provider (e.g. SMTP). */
  resolveProvider: () => Promise<NewsletterSendProvider>;
  resolveSender: () => Promise<{ fromEmail: string; fromName: string }>;
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
}

/**
 * Per-recipient campaign dispatch (feature 048, US2 — the Principle-X core).
 * Each recipient is atomically claimed by inserting its `newsletter_send_records`
 * row with `ON CONFLICT DO NOTHING`; only freshly-claimed rows are sent. Re-runs
 * and N≥2 workers therefore never double-send. The send is idempotent on the
 * record id (used as the provider `messageId`).
 */
export class NewsletterCampaignDispatchService {
  constructor(private readonly deps: CampaignDispatchDeps) {}

  /**
   * Atomically claim a recipient. Returns the new record id, or null when the
   * recipient was already claimed for this campaign.
   */
  private async claim(em: EntityManager, campaignId: string, subscriberId: string): Promise<string | null> {
    const id = randomUUID();
    const rows = (await em.getConnection().execute(
      `insert into newsletter_send_records (id, campaign_id, subscriber_id, status, click_count, created_at)
       values (?, ?, ?, 'queued', 0, now())
       on conflict (campaign_id, subscriber_id) where campaign_id is not null
       do nothing
       returning id`,
      [id, campaignId, subscriberId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string }>;
    return rows.length > 0 ? (rows[0]?.id ?? null) : null;
  }

  /** Dispatch one campaign to its full eligible audience. Safe to re-run. */
  async dispatchCampaign(campaignId: string): Promise<DispatchResult> {
    const em = this.deps.emFactory();
    const campaign = await em.findOneOrFail(NewsletterCampaign, { id: campaignId });

    const audienceIds = await this.deps.audience.resolve({
      type: campaign.targetType,
      tagIds: campaign.targetTagIds,
      campaignId: campaign.id,
    });

    const provider = await this.deps.resolveProvider();
    const sender = await this.deps.resolveSender();

    const result: DispatchResult = { claimed: 0, sent: 0, failed: 0 };
    for (const subscriberId of audienceIds) {
      const recordId = await this.claim(em, campaign.id, subscriberId);
      if (!recordId) continue; // already claimed — idempotent skip
      result.claimed += 1;
      await this.deliver(em, campaign, subscriberId, recordId, provider, sender, result);
    }

    campaign.status = 'sent';
    await em.persistAndFlush(campaign);
    return result;
  }

  private async deliver(
    em: EntityManager,
    campaign: NewsletterCampaign,
    subscriberId: string,
    recordId: string,
    provider: NewsletterSendProvider,
    sender: { fromEmail: string; fromName: string },
    result: DispatchResult,
  ): Promise<void> {
    const record = await em.findOneOrFail(NewsletterSendRecord, { id: recordId });
    if (record.status === 'sent') {
      result.sent += 1;
      return;
    }
    const subscriber = await em.findOneOrFail(NewsletterSubscriber, { id: subscriberId });
    const unsubscribeUrl = this.deps.links.unsubscribe(this.deps.optIn.mintUnsubscribeToken(subscriberId));

    const rendered = this.deps.content.render({
      subject: campaign.subject,
      content: campaign.content,
      context: {
        variables: {
          subscriber: { email: subscriber.email },
          customFields: subscriber.customFields,
          channel: { id: campaign.salesChannelId },
        },
        unsubscribeUrl,
      },
    });

    try {
      const res = await provider.send({
        to: subscriber.email,
        fromEmail: sender.fromEmail || 'noreply@localhost',
        ...(sender.fromName ? { fromName: sender.fromName } : {}),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        messageId: recordId,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
      });
      record.status = 'sent';
      record.sentAt = new Date();
      record.providerMessageId = res.providerMessageId ?? null;
      result.sent += 1;
    } catch (err) {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
      result.failed += 1;
    }
    await em.persistAndFlush(record);
  }
}
