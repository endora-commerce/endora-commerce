import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { FastifyRequest } from 'fastify';
import { Invoice } from './entities/invoice.entity.js';
import { InvoiceTemplate } from './entities/invoice-template.entity.js';
import { invoicesModule, type InvoicesModuleOptions, type InvoicesModuleHandle } from './plugin.js';
import { INVOICE_ISSUED_DEFAULT } from './email-templates/invoice-issued.default.js';
import type { EmailDefaultsRegistry } from '../transactional_emails/services/email-defaults-registry.js';

/**
 * `invoices` — a document module with a late-bound verifier (feature 072,
 * wave 2, T113).
 *
 * Six of the options are how this composition reaches outside itself: naming
 * the acting admin, resolving the calling customer, finding the transactional
 * email sender and a recipient address, picking a channel's language, and
 * loading logo bytes from `assets_library`. They are one contributed
 * {@link InvoicesBridge}, for the reason `pwa`'s and `mfa`'s are — always
 * supplied together, by the same caller.
 *
 * **The KSeF verification resolver is separate and stays separate.** A root
 * called `pdfRenderer.setKsefVerificationResolver(...)` after building both
 * modules, because `ksef` is constructed later. It is its own contribution
 * point rather than a bridge member: a deployment without KSeF has no verifier
 * and the PDF simply carries no verification block, whereas a deployment
 * missing half the bridge is incoherent. Same distinction `pwa`'s auto-trigger
 * resolvers drew — absence removes a feature, it does not weaken a check.
 *
 * `audit` and `auditLog` are two different sinks and both stop being optional:
 * the first records issuance and correction (FR-035), the second is the
 * co-transactional sink for template writes. An invoice is a legal document, so
 * "issued but unrecorded" is the wrong failure to leave reachable by omission.
 */

export const entities = [Invoice, InvoiceTemplate];

/** How this composition reaches outside the invoices module. */
export interface InvoicesBridge {
  readonly resolveAdminUserId: NonNullable<InvoicesModuleOptions['resolveAdminUserId']>;
  readonly resolveCustomerContext: NonNullable<
    InvoicesModuleOptions['resolveCustomerContext']
  >;
  readonly getTransactionalEmailSender: NonNullable<
    InvoicesModuleOptions['getTransactionalEmailSender']
  >;
  readonly resolveRecipientEmail: NonNullable<InvoicesModuleOptions['resolveRecipientEmail']>;
  readonly resolveLanguage: NonNullable<InvoicesModuleOptions['resolveLanguage']>;
  /**
   * Logo bytes for the PDF. Absent in a composition with no assets to load —
   * the harness omits it — and the invoice then renders without a logo image.
   * Absence removes a decoration, not a check.
   */
  readonly loadAssetImage?: InvoicesModuleOptions['loadAssetImage'];
}

export interface InvoicesCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  readonly settingsReadPort: InvoicesModuleOptions['settingsService'];
  readonly invoicesBridge: InvoicesBridge;
  /** Absent on a deployment without KSeF; the PDF then carries no verification block. */
  readonly ksefVerificationResolver:
    | Parameters<InvoicesModuleHandle['pdfRenderer']['setKsefVerificationResolver']>[0]
    | undefined;
  readonly invoices: { handle: InvoicesModuleHandle; plugin: unknown };
  readonly invoiceService: InvoicesModuleHandle['invoiceService'];
  readonly invoiceNumberGenerator: InvoicesModuleHandle['numberGenerator'];
  readonly invoicePdfRenderer: InvoicesModuleHandle['pdfRenderer'];
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point, absent by default: no KSeF, no verification block.
    ksefVerificationResolver: ctx
      .asFunction((): InvoicesCradle['ksefVerificationResolver'] => undefined)
      .singleton(),

    invoices: ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: InvoicesCradle) => {
        const bridge = (): InvoicesBridge => ctx.cradle<InvoicesCradle>().invoicesBridge;
        const result = invoicesModule({
          emFactory,
          eventBus,
          audit: auditLogService,
          auditLog: auditLogService,
          settingsService: lazyPort<InvoicesModuleOptions['settingsService']>(
            ctx,
            'settingsReadPort',
          ),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<InvoicesCradle>().requireAdmin(permission)(req, reply),
          requireCustomer: (req, reply) =>
            ctx.cradle<InvoicesCradle>().requireCustomer(req, reply),
          resolveAdminUserId: (req) => bridge().resolveAdminUserId(req),
          resolveCustomerContext: (req) => bridge().resolveCustomerContext(req),
          getTransactionalEmailSender: () => bridge().getTransactionalEmailSender(),
          resolveRecipientEmail: (order) => bridge().resolveRecipientEmail(order),
          resolveLanguage: (salesChannelId) => bridge().resolveLanguage(salesChannelId),
          // Spread, because `exactOptionalPropertyTypes` distinguishes an
          // omitted property from an explicit `undefined`, and the module's own
          // fallback depends on the property being absent.
          ...(ctx.cradle<InvoicesCradle>().invoicesBridge.loadAssetImage === undefined
            ? {}
            : {
                loadAssetImage: (assetId: Parameters<
                  NonNullable<InvoicesModuleOptions['loadAssetImage']>
                >[0]) => bridge().loadAssetImage!(assetId),
              }),
        });
        // Installed once, reading the contribution per call, so a root may
        // contribute the verifier at any point in its own ordering.
        result.handle.pdfRenderer.setKsefVerificationResolver(async (invoiceId) => {
          const resolve = ctx.cradle<InvoicesCradle>().ksefVerificationResolver;
          return resolve === undefined ? null : resolve(invoiceId);
        });
        return result;
      })
      .singleton(),
  });

  ctx.di.providePort(
    'invoiceService',
    ctx.asFunction(({ invoices }: InvoicesCradle) => invoices.handle.invoiceService).singleton(),
  );
  ctx.di.providePort(
    'invoiceNumberGenerator',
    ctx.asFunction(({ invoices }: InvoicesCradle) => invoices.handle.numberGenerator).singleton(),
  );
  ctx.di.providePort(
    'invoicePdfRenderer',
    ctx.asFunction(({ invoices }: InvoicesCradle) => invoices.handle.pdfRenderer).singleton(),
  );

  ctx.routes(async (app) => {
    const plugin = ctx.cradle<InvoicesCradle>().invoices.plugin as (
      a: typeof app,
    ) => Promise<void>;
    await plugin(app);
  });

  /**
   * The default subject and content for the 1 transactional email this
   * module declares in its manifest (T143a).
   *
   * These were fourteen `emailDefaultsRegistry.register(...)` calls in
   * `composition.ts`, each importing a template constant out of the module that
   * owns it — a root reaching into seven modules to hand their own content to
   * an eighth. Each module registers its own now.
   *
   * `ctx.onBoot` rather than a registration: the registry is *read* once, by
   * `transactional_emails`' boot reconciler inside its plugin body. Boot hooks
   * run during composition and plugin bodies only when the Fastify app is
   * built, so this always lands first — by construction, not by ordering luck.
   */
  ctx.onBoot(async () => {
    const defaults = lazyPort<EmailDefaultsRegistry>(ctx, 'emailDefaultsPort');
    defaults.register('invoice_issued', INVOICE_ISSUED_DEFAULT, 'invoices');
  });

}
