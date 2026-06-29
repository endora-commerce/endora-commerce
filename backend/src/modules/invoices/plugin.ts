import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModulePlugin } from '../../http/server.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import { InvoiceService } from './services/invoice-service.js';
import { InvoicePdfRenderer } from './services/invoice-pdf-renderer.js';
import { InvoiceNumberGenerator, createSettingsPatternResolver } from './services/invoice-number-generator.js';
import { SellerSettingsResolver, type SettingsReader } from './services/seller-settings.js';
import { registerInvoicesAdminRoutes, type InvoiceEmailDispatcher } from './routes.admin.js';
import { registerInvoicesCustomerRoutes } from './routes.customer.js';

export interface InvoicesModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  settingsService: SettingsReader;
  resolveAdminUserId?: (req: FastifyRequest) => string | null;
  /** Returns the customerAccountId/organizationId for an authenticated customer. */
  resolveCustomerContext?: (req: FastifyRequest) => { customerAccountId: string; organizationId: string };
  /** US5 — invoice email dispatcher (attachment/link). */
  emailDispatcher?: InvoiceEmailDispatcher;
}

export interface InvoicesModuleHandle {
  invoiceService: InvoiceService;
  pdfRenderer: InvoicePdfRenderer;
  numberGenerator: InvoiceNumberGenerator;
}

/**
 * Invoices module (feature 047). Owns invoice issuance, numbering, PDF
 * rendering, admin + customer routes. Cross-module access stays on documented
 * interfaces (SettingsService, requireAdmin/requireCustomer, the order
 * entities read read-only).
 */
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

  const handle: InvoicesModuleHandle = { invoiceService, pdfRenderer, numberGenerator };

  const plugin: ModulePlugin = async (app: FastifyInstance) => {
    await registerInvoicesAdminRoutes(app, {
      emFactory: options.emFactory,
      requireAdmin: options.requireAdmin,
      invoiceService,
      pdfRenderer,
      ...(options.emailDispatcher ? { emailDispatcher: options.emailDispatcher } : {}),
      ...(options.resolveAdminUserId ? { resolveAdminUserId: options.resolveAdminUserId } : {}),
    });
    if (options.resolveCustomerContext) {
      await registerInvoicesCustomerRoutes(app, {
        emFactory: options.emFactory,
        requireCustomer: options.requireCustomer,
        resolveCustomerContext: options.resolveCustomerContext,
        invoiceService,
        pdfRenderer,
      });
    }
  };

  return { handle, plugin };
}
