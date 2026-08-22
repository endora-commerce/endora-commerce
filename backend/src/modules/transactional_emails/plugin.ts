import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest } from '@b2b/contracts';
import type { SettingsReadPort } from '../../kernel/ports/settings.js';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { CommandBus } from '../../commands/index.js';
import type {
  EmailDeliveryRecorder,
  EmailMailerPort,
  SettingsAdminPort,
} from '@b2b/contracts';
import { ContentResolver } from './services/content-resolver.js';
import { BrandingService, type AssetUrlResolver } from './services/branding.service.js';
import { EmbedResolver } from './services/embed-resolver.js';
import { TransactionalEmailService } from './services/transactional-email.service.js';
import { EmailBlockService } from './services/email-block.service.js';
import { EmailTemplateService } from './services/email-template.service.js';
import { TransactionalEmailReconciler } from './services/manifest-reconciler.js';
import type { EmailDefaultsRegistry } from './services/email-defaults-registry.js';
import { registerTransactionalEmailsAdminRoutes } from './routes.admin.js';

export interface TransactionalEmailsModuleOptions {
  emFactory: () => EntityManager;
  settingsService: SettingsReadPort;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveAdminUserId: (req: FastifyRequest) => string | null;
  /** All registered module manifests — drives boot reconciliation of definitions. */
  manifests: ReadonlyArray<ModuleManifest>;
  /**
   * The registry the owning modules pushed their defaults into (T143a).
   *
   * Supplied rather than imported, so it is **one per composition**. The
   * module-level singleton this replaced was shared by every composition in the
   * process.
   */
  defaultsRegistry: EmailDefaultsRegistry;
  /** Audits the per-email activation flip (issue #89, Principle XIII). */
  commandBus: CommandBus;
  mailer?: EmailMailerPort;
  /**
   * Where a message this module suppresses — or cannot render — is recorded
   * (D-59). The transport records the ones it is handed; these never reach it.
   */
  deliveryRecorder?: EmailDeliveryRecorder;
  auditLog?: AuditPort;
  resolveAssetUrl?: AssetUrlResolver;
  /** Settings admin service used to persist branding values (US2). */
  settingsAdmin?: SettingsAdminPort;
  /** Exposes the sender back to composition so owning modules can send. */
  exposeSender?: (sender: TransactionalEmailService) => void;
  /** Exposes branding so newsletter (and others) can inject logoUrl/accent. */
  exposeBranding?: (branding: BrandingService) => void;
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
    const branding = new BrandingService(
      options.settingsService,
      options.resolveAssetUrl,
      options.settingsAdmin ? { admin: options.settingsAdmin, emFactory: options.emFactory } : undefined,
    );
    const embeds = new EmbedResolver();

    const service = new TransactionalEmailService({
      emFactory: options.emFactory,
      contentResolver,
      branding,
      embeds,
      defaults: options.defaultsRegistry,
      ...(options.mailer ? { mailer: options.mailer } : {}),
      ...(options.deliveryRecorder ? { deliveryRecorder: options.deliveryRecorder } : {}),
      ...(options.auditLog ? { auditLog: options.auditLog } : {}),
    });

    const blocks = new EmailBlockService(options.emFactory, options.auditLog);
    const templates = new EmailTemplateService(options.emFactory, options.auditLog);

    // Boot reconciliation: upsert definitions from manifests + registered defaults.
    const reconciler = new TransactionalEmailReconciler(
      options.emFactory,
      options.defaultsRegistry,
    );
    try {
      await reconciler.reconcile(options.manifests);
    } catch (err) {
      app.log.error({ err }, '[transactional_emails] manifest reconciliation failed');
      throw err;
    }

    options.exposeSender?.(service);
    options.exposeBranding?.(branding);

    await registerTransactionalEmailsAdminRoutes(app, {
      service,
      branding,
      blocks,
      templates,
      requireAdmin: options.requireAdmin,
      resolveAdminUserId: options.resolveAdminUserId,
      commandBus: options.commandBus,
      defaults: options.defaultsRegistry,
    });
  };
}
