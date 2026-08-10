import { z } from 'zod';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import { NEWSLETTER_SETTING_CODES } from '@b2b/contracts';
import type { ModulePlugin } from '../../http/server.js';
import { defineModuleRoutes, defineModuleWorker } from '../_lifecycle/plugin-helpers.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import type { Mailer } from '../email/services/mailer.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { NewsletterTokenHelper } from './services/token.helper.js';
import { NewsletterOptInService } from './services/opt-in.service.js';
import { NewsletterSubscriberService, type NewsletterLinkBuilder } from './services/subscriber.service.js';
import { NewsletterContentService } from './services/content.service.js';
import { NewsletterAudienceResolver } from './services/audience-resolver.js';
import { NewsletterCampaignDispatchService } from './services/campaign-dispatch.service.js';
import { NewsletterCampaignService } from './services/campaign.service.js';
import { NewsletterSubscriberAdminService } from './services/subscriber-admin.service.js';
import { NewsletterTagService } from './services/tag.service.js';
import { NewsletterCustomFieldService } from './services/custom-field.service.js';
import { NewsletterAutomationService } from './services/automation.service.js';
import { NewsletterTrackingService } from './services/tracking.service.js';
import { NewsletterStatsService } from './services/stats.service.js';
import { NewsletterEmailBlockService } from './services/email-block.service.js';
import { NewsletterProviderAdminService, type SettingsWriter } from './services/provider-admin.service.js';
import type { AdminAuditContext } from './services/provider-admin.types.js';
import {
  NewsletterProviderRegistry,
  type CredentialResolvePort,
} from './services/provider/provider-registry.js';
import {
  createCampaignPlanQueue,
  createSendQueue,
  createAutomationStepQueue,
  createCampaignPlanWorker,
  createSendWorker,
  createAutomationStepWorker,
} from './services/queues/newsletter-queues.js';
import { NewsletterSelfService } from './services/self.service.js';
import { ensureNewsletterConsentBlock } from './services/consent-block-seeder.js';
import { registerNewsletterStorefrontRoutes } from './routes.storefront.js';
import { registerNewsletterAdminRoutes } from './routes.admin.js';
import { registerNewsletterSelfRoutes } from './routes.self.js';

export interface NewsletterModuleOptions {
  emFactory: () => EntityManager;
  settings: SettingsService;
  tokenSecret: string;
  platformChannelId: string;
  resolveChannelIdByCode: (code: string) => Promise<string | null>;
  publicBaseUrl: string;
  storefrontBaseUrl: string;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Settings admin write surface (provider config + secret). */
  settingsWrite: SettingsWriter;
  /** Resolve the admin audit context from a request (for secret writes). */
  resolveAuditContext: (req: FastifyRequest) => AdminAuditContext;
  /** Customer session guard (self routes). */
  requireCustomer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Resolve the signed-in customer's account id (org-less). */
  resolveCustomerAccountId: (req: FastifyRequest) => string;
  /** Resolve a customer account's email (cross-module lookup). */
  loadCustomerEmail: (customerAccountId: string) => Promise<string | null>;
  mailer?: Mailer;
  auditLog?: AuditLogService;
  /** Optional observability emitter (wraps the in-process EventBus). */
  emitEvent?: (name: string, payload: Record<string, unknown>) => void;
  /** Redis connection — when present, dispatch is queue-backed (Principle X). */
  redis?: Redis;
  /** Whether this process runs queue consumers (BACKEND_ROLE != api). */
  runWorkers?: boolean;
  /**
   * Feature 058 — resolves the `newsletter.email_credentials` reference into a
   * usable SMTP transport. Injected as a narrow port (Principle I); when absent
   * the registry uses the legacy `newsletter.smtp.*` settings.
   */
  credentials?: CredentialResolvePort;
  /** Resolve transactional email branding (logo + accent) for a sales channel. */
  resolveEmailBranding?: (
    salesChannelId: string | null,
  ) => Promise<{ logoUrl: string; accentColor: string }>;
}

/**
 * Composition root for the newsletter module (feature 048). Builds the service
 * graph, the (optional) BullMQ dispatch queues + workers, and registers the
 * storefront + admin routes, all gated on the module's enabled state.
 */
export function newsletterModule(options: NewsletterModuleOptions): ModulePlugin {
  const tokens = new NewsletterTokenHelper(options.tokenSecret);
  const optIn = new NewsletterOptInService(options.settings, tokens);
  const content = new NewsletterContentService();
  const audience = new NewsletterAudienceResolver(options.emFactory);
  const providers = new NewsletterProviderRegistry(
    options.settings,
    options.platformChannelId,
    options.credentials,
  );

  const links: NewsletterLinkBuilder = {
    confirm: (t) => `${options.publicBaseUrl}/api/v1/newsletter/confirm?token=${encodeURIComponent(t)}`,
    unsubscribe: (t) =>
      `${options.publicBaseUrl}/api/v1/newsletter/unsubscribe?token=${encodeURIComponent(t)}`,
  };

  const subscribers = new NewsletterSubscriberService({
    emFactory: options.emFactory,
    optIn,
    platformChannelId: options.platformChannelId,
    links,
    ...(options.mailer ? { mailer: options.mailer } : {}),
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
    ...(options.emitEvent ? { emitEvent: options.emitEvent } : {}),
  });

  const subscriberAdmin = new NewsletterSubscriberAdminService(
    options.emFactory,
    options.auditLog,
  );
  const tags = new NewsletterTagService(options.emFactory, options.auditLog);
  const customFields = new NewsletterCustomFieldService(options.emFactory, options.auditLog);
  const tracking = new NewsletterTrackingService(options.emFactory);
  const stats = new NewsletterStatsService(options.emFactory);
  const blocks = new NewsletterEmailBlockService(options.emFactory, options.auditLog);
  const providerAdmin = new NewsletterProviderAdminService(
    options.settings,
    options.settingsWrite,
    providers,
    options.platformChannelId,
  );
  const self = new NewsletterSelfService(options.emFactory, subscribers);

  const dispatch = new NewsletterCampaignDispatchService({
    emFactory: options.emFactory,
    audience,
    content,
    optIn,
    links,
    resolveProvider: () => providers.resolveProvider(),
    resolveSender: () => providers.resolveSender(),
    ...(options.resolveEmailBranding
      ? { resolveEmailBranding: options.resolveEmailBranding }
      : {}),
  });

  // Producer-side queues (needed by the API to enqueue, regardless of worker role).
  const planQueue = options.redis ? createCampaignPlanQueue(options.redis) : undefined;
  const sendQueue = options.redis ? createSendQueue(options.redis) : undefined;
  const automationStepQueue = options.redis ? createAutomationStepQueue(options.redis) : undefined;

  const automations = new NewsletterAutomationService({
    emFactory: options.emFactory,
    content,
    optIn,
    links,
    resolveProvider: () => providers.resolveProvider(),
    resolveSender: () => providers.resolveSender(),
    enqueueStep: async (runId, stepIndex, delayMs) => {
      if (automationStepQueue) {
        await automationStepQueue.add('step', { runId, stepIndex }, delayMs ? { delay: delayMs } : {});
      }
    },
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
    ...(options.resolveEmailBranding
      ? { resolveEmailBranding: options.resolveEmailBranding }
      : {}),
  });

  const campaigns = new NewsletterCampaignService({
    emFactory: options.emFactory,
    dispatch,
    content,
    isProviderConfigured: () => providers.isConfigured(),
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
    ...(options.resolveEmailBranding
      ? { resolveEmailBranding: options.resolveEmailBranding }
      : {}),
    ...(planQueue
      ? {
          enqueuePlan: async (campaignId: string, delayMs?: number) => {
            const job = await planQueue.add(
              'plan',
              { campaignId },
              delayMs ? { delay: delayMs } : {},
            );
            return job.id;
          },
        }
      : {}),
  });

  return async (app) => {
    // Seed the predefined consent CMS block (idempotent; runs after channels
    // exist). Guarded so a platform without the CMS module simply skips it.
    try {
      await ensureNewsletterConsentBlock(options.emFactory);
    } catch (err) {
      app.log.warn({ err }, '[newsletter] consent CMS block seed skipped');
    }

    // Queue consumers (Principle X): separable, pause on disable.
    if (options.runWorkers && options.redis && planQueue && sendQueue) {
      let rate = 14;
      try {
        rate = await options.settings.get(
          NEWSLETTER_SETTING_CODES.RATE_LIMIT_PER_SECOND,
          options.platformChannelId,
          z.number(),
        );
      } catch {
        // default
      }
      defineModuleWorker(
        'newsletter',
        createCampaignPlanWorker(options.redis, async (job) => {
          const recordIds = await dispatch.planCampaign(job.data.campaignId);
          for (const recordId of recordIds) await sendQueue.add('send', { recordId });
        }),
        { logger: app.log },
      );
      defineModuleWorker(
        'newsletter',
        createSendWorker(
          options.redis,
          async (job) => {
            await dispatch.sendRecord(job.data.recordId);
          },
          rate,
        ),
        { logger: app.log },
      );
      if (automationStepQueue) {
        defineModuleWorker(
          'newsletter',
          createAutomationStepWorker(options.redis, async (job) => {
            await automations.processStep(job.data.runId, job.data.stepIndex);
          }),
          { logger: app.log },
        );
      }
    }

    await defineModuleRoutes('newsletter', async (scoped) => {
      await registerNewsletterStorefrontRoutes(scoped, {
        subscribers,
        optIn,
        tokens,
        tracking,
        resolveChannelIdByCode: options.resolveChannelIdByCode,
        platformChannelId: options.platformChannelId,
        storefrontBaseUrl: options.storefrontBaseUrl,
      });
      await registerNewsletterAdminRoutes(scoped, {
        campaigns,
        subscribers,
        subscriberAdmin,
        tags,
        customFields,
        automations,
        stats,
        providerAdmin,
        blocks,
        resolveAuditContext: options.resolveAuditContext,
        requireAdmin: options.requireAdmin,
      });
      await registerNewsletterSelfRoutes(scoped, {
        self,
        requireCustomer: options.requireCustomer,
        resolveCustomerAccountId: options.resolveCustomerAccountId,
        loadCustomerEmail: options.loadCustomerEmail,
      });
    })(app);
  };
}
