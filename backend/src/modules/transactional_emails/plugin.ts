import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest } from '@b2b/contracts';
import type { SettingsService } from '../settings/services/settings.service.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { Mailer } from '../email/services/mailer.js';
import { ContentResolver } from './services/content-resolver.js';
import { BrandingService, type AssetUrlResolver } from './services/branding.service.js';
import { EmbedResolver } from './services/embed-resolver.js';
import { TransactionalEmailService } from './services/transactional-email.service.js';
import { EmailBlockService } from './services/email-block.service.js';
import { EmailTemplateService } from './services/email-template.service.js';
import { TransactionalEmailReconciler } from './services/manifest-reconciler.js';
import { emailDefaultsRegistry } from './services/email-defaults-registry.js';
import { registerTransactionalEmailsAdminRoutes } from './routes.admin.js';

export interface TransactionalEmailsModuleOptions {
  emFactory: () => EntityManager;
  settingsService: SettingsService;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveAdminUserId: (req: FastifyRequest) => string | null;
  /** All registered module manifests — drives boot reconciliation of definitions. */
  manifests: ReadonlyArray<ModuleManifest>;
  mailer?: Mailer;
  auditLog?: AuditLogService;
  resolveAssetUrl?: AssetUrlResolver;
  /** Exposes the sender back to composition so owning modules can send. */
  exposeSender?: (sender: TransactionalEmailService) => void;
}

/**
 * Composition root for the transactional_emails module (feature 047). Builds the
 * resolver/branding/embed/render services, reconciles email definitions from
 * manifests at boot, registers the admin routes, and exposes the sender port.
 */
export function transactionalEmailsModule(
  options: TransactionalEmailsModuleOptions,
): (app: FastifyInstance) => Promise<void> {
  return async (app: FastifyInstance): Promise<void> => {
    const contentResolver = new ContentResolver();
    const branding = new BrandingService(options.settingsService, options.resolveAssetUrl);
    const embeds = new EmbedResolver();

    const service = new TransactionalEmailService({
      emFactory: options.emFactory,
      contentResolver,
      branding,
      embeds,
      ...(options.mailer ? { mailer: options.mailer } : {}),
      ...(options.auditLog ? { auditLog: options.auditLog } : {}),
    });

    const blocks = new EmailBlockService(options.emFactory);
    const templates = new EmailTemplateService(options.emFactory);

    // Boot reconciliation: upsert definitions from manifests + registered defaults.
    const reconciler = new TransactionalEmailReconciler(options.emFactory, emailDefaultsRegistry);
    try {
      await reconciler.reconcile(options.manifests);
    } catch (err) {
      app.log.error({ err }, '[transactional_emails] manifest reconciliation failed');
      throw err;
    }

    options.exposeSender?.(service);

    await registerTransactionalEmailsAdminRoutes(app, {
      service,
      branding,
      blocks,
      templates,
      requireAdmin: options.requireAdmin,
      resolveAdminUserId: options.resolveAdminUserId,
    });
  };
}
