import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReadPort,
  ComarchXlSaleDocumentAttachmentPort,
  OrderReadPort,
  OrderRecord,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import { InvoiceService, type InvoiceAuditRecorder } from './services/invoice-service.js';
import type { LedgerNumberingLookup } from './services/vendor-number-hold.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { InvoicePdfRenderer } from './services/invoice-pdf-renderer.js';
import type { LoadAssetImage } from './pdf-components/embed-logo-images.js';
import { InvoiceNumberGenerator, createSettingsPatternResolver } from './services/invoice-number-generator.js';
import { SellerSettingsResolver, type SettingsReader } from './services/seller-settings.js';
import { InvoiceEmailDispatcher } from './services/invoice-email-dispatch.js';
import { InvoiceTemplateService } from './services/invoice-template-service.js';
import { createAutoIssueReactor } from './services/auto-issue-reactor.js';
import { registerInvoicesAdminRoutes } from './routes.admin.js';
import { registerInvoicesCustomerRoutes } from './routes.customer.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * The attach function this module hands its composition root.
 *
 * Typed on `fastify`'s own `FastifyInstance` rather than on the platform's
 * `ModulePlugin`, which `contracts/host-package.md` §1.4g classifies **A**: the
 * host does not publish it, so a packaged module cannot name it. The
 * already-packaged `quote_requests` types its attach function the same way.
 */
type ModuleAttach = (app: FastifyInstance) => Promise<void>;

/**
 * Minimal event-bus surface this module needs. Emission only: the FR-002
 * subscription moved to `backend.ts` and `ctx.subscribe` (issue #107), so this
 * no longer carries `on`.
 */
export interface InvoicesEventBus {
  /** Present on the real EventBus — used to emit invoice.issued/corrected.v1 (feature 059). */
  emit?(eventName: string, payload: { eventId: string; occurredAt: string }): void;
}

export interface InvoicesModuleOptions {
  emFactory: () => EntityManager;
  /**
   * `orders`' published read model (feature 075, Phase C). Not optional: an
   * invoice is a document *about an order*, so a module that cannot read one
   * has nothing to issue. Every read of the order rows used to be
   * `em.findOne(Order, …)` from inside this module — a query no gate can see,
   * so an invoice went on being issued against a module an operator had
   * switched off.
   */
  orderReadPort: OrderReadPort;
  assetReadPort: AssetReadPort;
  saleDocumentAttachments: ComarchXlSaleDocumentAttachmentPort;
  requireAdmin: RequireAdminFactory;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  settingsService: SettingsReader;
  /**
   * The five that stopped being optional in
   * `specs/110-instance-repository/` T118c.
   *
   * Each was a member of the contributed `invoicesBridge` and each was declared
   * `?`, which was true of the *contribution* and never of the module: this
   * module resolves all five itself now — the platform's two actor resolvers,
   * `transactional_emails`' sender accessor, `customer_accounts`' record and a
   * read of the channel — so no composition can decline to supply one. An
   * option that is nonetheless typed as omittable is a branch no test can
   * drive, which is what `loadAssetImage` was until D-223 and what the
   * e-mail trio still is: `emailDispatcher` was built only when all three were
   * present, so a composition that dropped one silently stopped sending
   * invoices and answered `no_sender`.
   */
  resolveAdminUserId: (req: FastifyRequest) => string | null;
  resolveCustomerContext: (req: FastifyRequest) => { customerAccountId: string; organizationId: string };
  /** US5 — transactional email sender (late-bound). */
  getTransactionalEmailSender: () => TransactionalEmailSender | undefined;
  /** US5 — recipient email for an order (customer account email). */
  resolveRecipientEmail: (order: OrderRecord) => Promise<string | null>;
  /** US5 — channel default language (BCP-47). */
  resolveLanguage: (salesChannelId: string | null) => Promise<string>;
  /** Feature 059 — emits `invoice.issued.v1` / `invoice.corrected.v1`. */
  eventBus?: InvoicesEventBus;
  /** FR-035 — audit-log recorder for issuance / correction. */
  audit?: InvoiceAuditRecorder;
  /** Feature 054 — full audit sink for invoice-template writes (co-transactional). */
  auditLog?: AuditPort;
  /**
   * Load image bytes for InvoiceLogo from the Assets Library (avoids pdfmake
   * self-fetching `/assets/file/:id` during Preview PDF).
   */
  loadAssetImage: LoadAssetImage;
  /** Mode B wait. Absent ledger degrades to today's ready path. */
  ledgerRouting?: LedgerNumberingLookup;
}

export interface InvoicesModuleHandle {
  /** FR-002 reactor; `backend.ts` owns its subscription. */
  autoIssueReactor: ReturnType<typeof createAutoIssueReactor>;
  invoiceService: InvoiceService;
  pdfRenderer: InvoicePdfRenderer;
  numberGenerator: InvoiceNumberGenerator;
  templateService: InvoiceTemplateService;
  emailDispatcher: InvoiceEmailDispatcher;
  /**
   * The logo loader this module resolved for itself (T118c).
   *
   * On the handle because that is the only place the *composed* value is
   * observable: the renderer holds it privately, and a test asserting it
   * through a rendered PDF would be asserting pdfmake. D-223's survey found it
   * supplied by one root and omitted by the other, so what this exposes is the
   * exact thing that went unnoticed.
   */
  loadAssetImage: LoadAssetImage;
}

export function invoicesModule(options: InvoicesModuleOptions): {
  handle: InvoicesModuleHandle;
  plugin: ModuleAttach;
} {
  const numberGenerator = new InvoiceNumberGenerator(
    createSettingsPatternResolver(options.settingsService),
  );
  const sellerSettings = new SellerSettingsResolver(options.settingsService);
  const emailOnReadyHolder: { dispatch?: (invoiceId: string) => Promise<void> } = {};
  const invoiceService = new InvoiceService(
    options.emFactory,
    options.orderReadPort,
    numberGenerator,
    sellerSettings,
    options.audit,
    options.eventBus?.emit
      ? {
          emit: (eventName: string, payload: Record<string, unknown>) =>
            options.eventBus!.emit!(eventName, payload as { eventId: string; occurredAt: string }),
        }
      : undefined,
    async (invoiceId) => {
      await emailOnReadyHolder.dispatch?.(invoiceId);
    },
    options.ledgerRouting,
  );
  const pdfRenderer = new InvoicePdfRenderer({ loadAssetImage: options.loadAssetImage });
  const templateService = new InvoiceTemplateService(options.emFactory, options.auditLog);

  // T118c — built unconditionally. The three inputs used to be optional bridge
  // members, so a composition that supplied two of the three got no dispatcher
  // at all and every issued invoice answered `not_sent` / `no_sender` — a
  // plausible-looking outcome rather than a visible failure. The module
  // resolves all three itself now and there is nothing left to be absent.
  const emailDispatcher = new InvoiceEmailDispatcher({
    orderReadPort: options.orderReadPort,
    invoiceService,
    pdfRenderer,
    settingsService: options.settingsService,
    getSender: options.getTransactionalEmailSender,
    resolveRecipientEmail: options.resolveRecipientEmail,
    resolveLanguage: options.resolveLanguage,
  });
  emailOnReadyHolder.dispatch = async (invoiceId) => {
    await emailDispatcher.dispatch(invoiceId);
  };

  // FR-002 — the auto-issue reactor. `backend.ts` registers it through
  // `ctx.subscribe`, so a switched-off module issues nothing.
  const autoIssueReactor = createAutoIssueReactor({
    emFactory: options.emFactory,
    invoiceService,
    settingsService: options.settingsService,
    emailDispatcher,
  });

  const handle: InvoicesModuleHandle = {
    autoIssueReactor,
    invoiceService,
    pdfRenderer,
    numberGenerator,
    templateService,
    emailDispatcher,
    loadAssetImage: options.loadAssetImage,
  };

  const plugin: ModuleAttach = async (app: FastifyInstance) => {
    // Seed the system generic template once (idempotent).
    await templateService.ensureGenericSeed().catch(() => undefined);
    await registerInvoicesAdminRoutes(app, {
      emFactory: options.emFactory,
      orderReadPort: options.orderReadPort,
      requireAdmin: options.requireAdmin,
      invoiceService,
      pdfRenderer,
      templateService,
      emailDispatcher,
      resolveAdminUserId: options.resolveAdminUserId,
    });
    await registerInvoicesCustomerRoutes(app, {
      emFactory: options.emFactory,
      orderReadPort: options.orderReadPort,
      assetReadPort: options.assetReadPort,
      saleDocumentAttachments: options.saleDocumentAttachments,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      invoiceService,
      pdfRenderer,
      templateService,
    });
  };

  return { handle, plugin };
}
