import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { NewsletterSendProvider } from '@b2b/contracts';
import { NewsletterCampaign } from '../entities/newsletter-campaign.entity.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSendRecord } from '../entities/newsletter-send-record.entity.js';
import type { NewsletterAudienceResolver } from './audience-resolver.js';
import type { NewsletterContentService, EmailBrandingResolver } from './content.service.js';
import { withEmailBranding } from './content.service.js';
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
  resolveEmailBranding?: EmailBrandingResolver;
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  failed: number;
}

/**
 * Per-recipient campaign dispatch (feature 048, US2 — the Principle-X core).
 *
 * Split into the two queue phases so the BullMQ workers map onto it directly:
 *  - `planCampaign`: resolve the audience and atomically claim a send record per
 *    recipient (`INSERT … ON CONFLICT DO NOTHING`); returns the freshly-claimed
 *    record ids. Re-runs claim nothing new, so N≥2 plan workers are safe.
 *  - `sendRecord`: render + provider-send one claimed record, idempotent on the
 *    record id (used as the provider `messageId`).
 *
 * `dispatchCampaign` runs both phases inline (used by tests and the console
 * fallback path).
 */
export class NewsletterCampaignDispatchService {
  constructor(private readonly deps: CampaignDispatchDeps) {}

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

  /** Phase 1: resolve audience, claim records, mark the campaign `sending`. */
  async planCampaign(campaignId: string): Promise<string[]> {
    // command-coverage-ignore: campaign send execution — materializes per-
    // recipient send records; delivery bookkeeping (the campaign send action is
    // audited in campaign.service).
    const em = this.deps.emFactory();
    const campaign = await em.findOneOrFail(NewsletterCampaign, { id: campaignId });
    const audienceIds = await this.deps.audience.resolve({
      type: campaign.targetType,
      tagIds: campaign.targetTagIds,
      campaignId: campaign.id,
    });
    const claimed: string[] = [];
    for (const subscriberId of audienceIds) {
      const recordId = await this.claim(em, campaign.id, subscriberId);
      if (recordId) claimed.push(recordId);
    }
    if (campaign.status !== 'sent') {
      campaign.status = 'sending';
      await em.persistAndFlush(campaign);
    }
    return claimed;
  }

  /** Phase 2: render + send one claimed record. Idempotent. */
  async sendRecord(recordId: string): Promise<'sent' | 'failed' | 'skipped'> {
    // command-coverage-ignore: campaign send execution — dispatches one send
    // record and stamps its status; delivery bookkeeping.
    const em = this.deps.emFactory();
    const record = await em.findOne(NewsletterSendRecord, { id: recordId });
    if (!record || !record.campaignId) return 'skipped';
    if (record.status === 'sent') return 'skipped';

    const campaign = await em.findOneOrFail(NewsletterCampaign, { id: record.campaignId });
    const subscriber = await em.findOneOrFail(NewsletterSubscriber, { id: record.subscriberId });
    const provider = await this.deps.resolveProvider();
    const sender = await this.deps.resolveSender();
    const unsubscribeUrl = this.deps.links.unsubscribe(
      this.deps.optIn.mintUnsubscribeToken(subscriber.id),
    );

    const branded = await withEmailBranding(
      {
        subscriber: { email: subscriber.email },
        customFields: subscriber.customFields,
        channel: { id: campaign.salesChannelId },
      },
      campaign.salesChannelId,
      this.deps.resolveEmailBranding,
    );
    const rendered = this.deps.content.render({
      subject: campaign.subject,
      content: campaign.content,
      ...(branded.accentColor !== undefined ? { accentColor: branded.accentColor } : {}),
      context: {
        variables: branded.variables,
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
        messageId: record.id,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
      });
      record.status = 'sent';
      record.sentAt = new Date();
      record.providerMessageId = res.providerMessageId ?? null;
      await em.persistAndFlush(record);
      return 'sent';
    } catch (err) {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
      await em.persistAndFlush(record);
      return 'failed';
    }
  }

  /** Inline both phases (tests + console fallback). Safe to re-run. */
  async dispatchCampaign(campaignId: string): Promise<DispatchResult> {
    // command-coverage-ignore: campaign send execution — drains the send queue;
    // delivery bookkeeping.
    const claimedIds = await this.planCampaign(campaignId);
    const result: DispatchResult = { claimed: claimedIds.length, sent: 0, failed: 0 };
    for (const recordId of claimedIds) {
      const outcome = await this.sendRecord(recordId);
      if (outcome === 'sent') result.sent += 1;
      else if (outcome === 'failed') result.failed += 1;
    }
    const em = this.deps.emFactory();
    const campaign = await em.findOneOrFail(NewsletterCampaign, { id: campaignId });
    campaign.status = 'sent';
    await em.persistAndFlush(campaign);
    return result;
  }
}
