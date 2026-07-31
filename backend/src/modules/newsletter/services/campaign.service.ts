import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CampaignDetail,
  type CampaignSummary,
  type CreateCampaignRequest,
  type UpdateCampaignRequest,
  type RenderedEmail,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { NewsletterCampaign } from '../entities/newsletter-campaign.entity.js';
import { NewsletterCampaignSubscriber } from '../entities/newsletter-campaign-subscriber.entity.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import type { NewsletterCampaignDispatchService } from './campaign-dispatch.service.js';
import type { NewsletterContentService, EmailBrandingResolver } from './content.service.js';
import { withEmailBranding } from './content.service.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';

export interface CampaignServiceDeps {
  emFactory: () => EntityManager;
  dispatch: NewsletterCampaignDispatchService;
  content: NewsletterContentService;
  isProviderConfigured: () => Promise<boolean>;
  /** Feature 054 — audits campaign lifecycle writes co-transactionally when provided. */
  auditLog?: AuditLogService;
  /**
   * Enqueue the plan job (production). When omitted, send runs the dispatch
   * inline (console fallback / tests). `delayMs` schedules a future fire.
   */
  enqueuePlan?: (campaignId: string, delayMs?: number) => Promise<string | undefined>;
  resolveEmailBranding?: EmailBrandingResolver;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/** Campaign CRUD + send (feature 048, US2). */
export class NewsletterCampaignService {
  constructor(private readonly deps: CampaignServiceDeps) {}

  #audit(em: EntityManager, action: string, objectId: string, stateAfter: Record<string, unknown> | null): void {
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action,
        objectType: 'newsletter_campaign',
        objectId,
        stateBefore: null,
        stateAfter,
      });
    }
  }

  async create(input: CreateCampaignRequest): Promise<CampaignDetail> {
    const em = this.deps.emFactory();
    const campaign = em.create(NewsletterCampaign, {
      name: input.name,
      subject: input.subject,
      content: input.content,
      salesChannelId: input.salesChannelId ?? null,
      language: input.language,
      targetType: input.targetType,
      targetTagIds: input.targetTagIds ?? [],
      trackingEnabled: input.trackingEnabled ?? true,
    });
    em.persist(campaign);
    this.#audit(em, 'newsletter_campaign.create', campaign.id, { name: campaign.name });
    await em.flush();
    return this.toDetail(campaign);
  }

  async update(id: string, input: UpdateCampaignRequest): Promise<CampaignDetail> {
    const em = this.deps.emFactory();
    const campaign = await this.load(em, id);
    this.assertVersion(campaign, input.expectedVersion);
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Only draft/scheduled campaigns can be edited.');
    }
    if (input.name !== undefined) campaign.name = input.name;
    if (input.subject !== undefined) campaign.subject = input.subject;
    if (input.content !== undefined) campaign.content = input.content;
    if (input.salesChannelId !== undefined) campaign.salesChannelId = input.salesChannelId ?? null;
    if (input.language !== undefined) campaign.language = input.language;
    if (input.targetType !== undefined) campaign.targetType = input.targetType;
    if (input.targetTagIds !== undefined) campaign.targetTagIds = input.targetTagIds;
    if (input.trackingEnabled !== undefined) campaign.trackingEnabled = input.trackingEnabled;
    campaign.version += 1;
    this.#audit(em, 'newsletter_campaign.update', campaign.id, { name: campaign.name });
    await em.persistAndFlush(campaign);
    return this.toDetail(campaign);
  }

  async get(id: string): Promise<CampaignDetail> {
    const em = this.deps.emFactory();
    return this.toDetail(await this.load(em, id));
  }

  async list(): Promise<{ items: CampaignSummary[] }> {
    const em = this.deps.emFactory();
    const rows = await em.find(NewsletterCampaign, {}, { orderBy: { createdAt: 'desc' } });
    return { items: rows.map((c) => this.toSummary(c)) };
  }

  async setGroup(id: string, subscriberIds: string[]): Promise<CampaignDetail> {
    const em = this.deps.emFactory();
    const campaign = await this.load(em, id);
    await em.nativeDelete(NewsletterCampaignSubscriber, { campaignId: id });
    for (const subscriberId of subscriberIds) {
      em.create(NewsletterCampaignSubscriber, { campaignId: id, subscriberId });
    }
    this.#audit(em, 'newsletter_campaign.set_group', id, { subscriberCount: subscriberIds.length });
    await em.flush();
    return this.toDetail(campaign);
  }

  async send(id: string, expectedVersion: number, scheduledAt?: Date): Promise<CampaignDetail> {
    const em = this.deps.emFactory();
    const campaign = await this.load(em, id);
    this.assertVersion(campaign, expectedVersion);
    if (!(await this.deps.isProviderConfigured())) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'No sending provider configured.', {
        code: 'provider_not_configured',
      });
    }

    const now = Date.now();
    const future = scheduledAt && scheduledAt.getTime() > now ? scheduledAt : undefined;
    if (this.deps.enqueuePlan) {
      const delayMs = future ? future.getTime() - now : undefined;
      const jobId = await this.deps.enqueuePlan(id, delayMs);
      campaign.dispatchJobId = jobId ?? null;
      campaign.status = future ? 'scheduled' : 'sending';
      campaign.scheduledAt = future ?? null;
      campaign.version += 1;
      this.#audit(em, 'newsletter_campaign.send', id, { status: campaign.status, scheduledAt: iso(campaign.scheduledAt) });
      await em.persistAndFlush(campaign);
    } else {
      // Inline path (console fallback / tests): dispatch immediately.
      await this.deps.dispatch.dispatchCampaign(id);
      const fresh = await this.load(this.deps.emFactory(), id);
      return this.toDetail(fresh);
    }
    return this.toDetail(campaign);
  }

  async cancel(id: string, expectedVersion: number): Promise<CampaignDetail> {
    const em = this.deps.emFactory();
    const campaign = await this.load(em, id);
    this.assertVersion(campaign, expectedVersion);
    if (campaign.status !== 'scheduled' && campaign.status !== 'draft') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Only draft/scheduled campaigns can be cancelled.');
    }
    campaign.status = 'cancelled';
    campaign.version += 1;
    this.#audit(em, 'newsletter_campaign.cancel', id, { status: 'cancelled' });
    await em.persistAndFlush(campaign);
    return this.toDetail(campaign);
  }

  async preview(id: string, subscriberId?: string): Promise<RenderedEmail> {
    const em = this.deps.emFactory();
    const campaign = await this.load(em, id);
    let email = 'sample@example.com';
    let customFields: Record<string, string | number | boolean | null> = {};
    if (subscriberId) {
      const sub = await em.findOne(NewsletterSubscriber, { id: subscriberId });
      if (sub) {
        email = sub.email;
        customFields = sub.customFields;
      }
    }
    const branded = await withEmailBranding(
      { subscriber: { email }, customFields, channel: { id: campaign.salesChannelId } },
      campaign.salesChannelId,
      this.deps.resolveEmailBranding,
    );
    return this.deps.content.render({
      subject: campaign.subject,
      content: campaign.content,
      ...(branded.accentColor !== undefined ? { accentColor: branded.accentColor } : {}),
      context: {
        variables: branded.variables,
        unsubscribeUrl: 'https://example.com/newsletter/unsubscribe?token=sample',
      },
    });
  }

  private async load(em: EntityManager, id: string): Promise<NewsletterCampaign> {
    const campaign = await em.findOne(NewsletterCampaign, { id });
    if (!campaign) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Campaign not found.');
    return campaign;
  }

  private assertVersion(campaign: NewsletterCampaign, expected: number): void {
    if (campaign.version !== expected) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Campaign was modified by someone else.');
    }
  }

  private toSummary(c: NewsletterCampaign): CampaignSummary {
    return {
      id: c.id,
      name: c.name,
      subject: c.subject,
      status: c.status,
      targetType: c.targetType,
      scheduledAt: iso(c.scheduledAt),
      createdAt: c.createdAt.toISOString(),
    };
  }

  private toDetail(c: NewsletterCampaign): CampaignDetail {
    return {
      ...this.toSummary(c),
      content: c.content,
      salesChannelId: c.salesChannelId ?? null,
      language: c.language,
      targetTagIds: c.targetTagIds,
      trackingEnabled: c.trackingEnabled,
      audienceEstimate: null,
      stats: null,
      version: c.version,
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
