import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { TransactionalEmailSender } from '@b2b/contracts';
import type { ModulePlugin } from '../../http/server.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { Order } from '../orders/entities/order.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import { InvoiceService } from './services/invoice-service.js';
import { InvoicePdfRenderer } from './services/invoice-pdf-renderer.js';
import { InvoiceNumberGenerator, createSettingsPatternResolver } from './services/invoice-number-generator.js';
import { SellerSettingsResolver, type SettingsReader } from './services/seller-settings.js';
import { InvoiceEmailDispatcher } from './services/invoice-email-dispatch.js';
import { InvoiceTemplateService } from './services/invoice-template-service.js';
import { registerInvoicesAdminRoutes } from './routes.admin.js';
import { registerInvoicesCustomerRoutes } from './routes.customer.js';
import { INVOICES_SETTING_CODES } from './manifest.js';

/** Minimal event-bus surface this module needs (auto-issue subscription). */
export interface InvoicesEventBus {
  on(eventName: string, handler: (payload: unknown) => void | Promise<void>): () => void;
}

export interface InvoicesModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  settingsService: SettingsReader;
  resolveAdminUserId?: (req: FastifyRequest) => string | null;
  resolveCustomerContext?: (req: FastifyRequest) => { customerAccountId: string; organizationId: string };
  /** US5 — transactional email sender (late-bound). */
  getTransactionalEmailSender?: () => TransactionalEmailSender | undefined;
  /** US5 — recipient email for an order (customer account email). */
  resolveRecipientEmail?: (order: Order) => Promise<string | null>;
  /** US5 — channel default language (BCP-47). */
  resolveLanguage?: (salesChannelId: string | null) => Promise<string>;
  /** FR-002 — auto-issue on order status change. */
  eventBus?: InvoicesEventBus;
}

export interface InvoicesModuleHandle {
  invoiceService: InvoiceService;
  pdfRenderer: InvoicePdfRenderer;
  numberGenerator: InvoiceNumberGenerator;
  templateService: InvoiceTemplateService;
  emailDispatcher?: InvoiceEmailDispatcher;
}

export function invoicesModule(options: InvoicesModuleOptions): {
  handle: InvoicesModuleHandle;
  plugin: ModulePlugin;
} {
  const numberGenerator = new InvoiceNumberGenerator(
    createSettingsPatternResolver(options.settingsService),
  );
  const sellerSettings = new SellerSettingsResolver(options.settingsService);
  const invoiceService = new InvoiceService(options.emFactory, numberGenerator, sellerSettings);
  const pdfRenderer = new InvoicePdfRenderer();
  const templateService = new InvoiceTemplateService(options.emFactory);

  let emailDispatcher: InvoiceEmailDispatcher | undefined;
  if (options.getTransactionalEmailSender && options.resolveRecipientEmail && options.resolveLanguage) {
    emailDispatcher = new InvoiceEmailDispatcher({
      emFactory: options.emFactory,
      invoiceService,
      pdfRenderer,
      settingsService: options.settingsService,
      getSender: options.getTransactionalEmailSender,
      resolveRecipientEmail: options.resolveRecipientEmail,
      resolveLanguage: options.resolveLanguage,
    });
  }

  const handle: InvoicesModuleHandle = {
    invoiceService,
    pdfRenderer,
    numberGenerator,
    templateService,
    ...(emailDispatcher ? { emailDispatcher } : {}),
  };

  // FR-002 — auto-issue an invoice when an order reaches the configured status.
  if (options.eventBus) {
    options.eventBus.on('order.status_changed.v1', async (payload) => {
      const p = payload as { orderId?: string; salesChannelId?: string; to?: string };
      if (!p.orderId || !p.salesChannelId || !p.to) return;
      let trigger = '';
      try {
        trigger = await options.settingsService.get(
          INVOICES_SETTING_CODES.AUTO_ISSUE_TRIGGER_STATUS,
          p.salesChannelId,
          z.string(),
        );
      } catch {
        trigger = '';
      }
      if (!trigger || trigger !== p.to) return;
      const em = options.emFactory();
      const existing = await em.findOne(Invoice, { orderId: p.orderId, kind: 'invoice' });
      if (existing) return; // idempotent
      try {
        const detail = await invoiceService.issue(p.orderId, 'invoice', { issuedBy: 'system' });
        if (emailDispatcher && (await emailDispatcher.sendOnIssueEnabled(detail.salesChannelId))) {
          await emailDispatcher.dispatch(detail.id);
        }
      } catch {
        // Best-effort auto-issue; manual issuance remains available.
      }
    });
  }

  const plugin: ModulePlugin = async (app: FastifyInstance) => {
    // Seed the system generic template once (idempotent).
    await templateService.ensureGenericSeed().catch(() => undefined);
    await registerInvoicesAdminRoutes(app, {
      emFactory: options.emFactory,
      requireAdmin: options.requireAdmin,
      invoiceService,
      pdfRenderer,
      templateService,
      ...(emailDispatcher ? { emailDispatcher } : {}),
      ...(options.resolveAdminUserId ? { resolveAdminUserId: options.resolveAdminUserId } : {}),
    });
    if (options.resolveCustomerContext) {
      await registerInvoicesCustomerRoutes(app, {
        emFactory: options.emFactory,
        requireCustomer: options.requireCustomer,
        resolveCustomerContext: options.resolveCustomerContext,
        invoiceService,
        pdfRenderer,
        templateService,
      });
    }
  };

  return { handle, plugin };
}
