import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModulePlugin } from '../../http/server.js';
import { defineModuleRoutes } from '../_lifecycle/plugin-helpers.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import type { Mailer } from '../email/services/mailer.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import { NewsletterTokenHelper } from './services/token.helper.js';
import { NewsletterOptInService } from './services/opt-in.service.js';
import { NewsletterSubscriberService, type NewsletterLinkBuilder } from './services/subscriber.service.js';
import { registerNewsletterStorefrontRoutes } from './routes.storefront.js';

export interface NewsletterModuleOptions {
  emFactory: () => EntityManager;
  settings: SettingsService;
  /** HMAC secret for confirm/unsubscribe/open/click tokens. */
  tokenSecret: string;
  /** Channel id used for platform-scoped Settings reads. */
  platformChannelId: string;
  /** Resolve a sales-channel code to its id; null when unknown. */
  resolveChannelIdByCode: (code: string) => Promise<string | null>;
  /** Public API base used to build email links (confirm/unsubscribe). */
  publicBaseUrl: string;
  /** Storefront base used for post-action redirects. */
  storefrontBaseUrl: string;
  mailer?: Mailer;
  auditLog?: AuditLogService;
}

/**
 * Composition root for the newsletter module (feature 048). Builds the
 * subscriber/opt-in services and registers the public storefront routes,
 * gated on the module's enabled state (503 when disabled — US8).
 */
export function newsletterModule(options: NewsletterModuleOptions): ModulePlugin {
  const tokens = new NewsletterTokenHelper(options.tokenSecret);
  const optIn = new NewsletterOptInService(options.settings, tokens);

  const links: NewsletterLinkBuilder = {
    confirm: (token) => `${options.publicBaseUrl}/api/v1/newsletter/confirm?token=${encodeURIComponent(token)}`,
    unsubscribe: (token) =>
      `${options.publicBaseUrl}/api/v1/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
  };

  const subscribers = new NewsletterSubscriberService({
    emFactory: options.emFactory,
    optIn,
    platformChannelId: options.platformChannelId,
    links,
    ...(options.mailer ? { mailer: options.mailer } : {}),
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
  });

  return defineModuleRoutes('newsletter', async (app) => {
    await registerNewsletterStorefrontRoutes(app, {
      subscribers,
      optIn,
      tokens,
      resolveChannelIdByCode: options.resolveChannelIdByCode,
      platformChannelId: options.platformChannelId,
      storefrontBaseUrl: options.storefrontBaseUrl,
    });
  });
}
