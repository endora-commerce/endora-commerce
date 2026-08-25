import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { EventBus } from '../../events/bus.js';
import type {
  CorrectiveInvoicePort,
  EmailDefaultsRegistryPort,
  InvoicePdfPort,
  InvoiceReadPort,
  OrderReadPort,
  SettingWriteValidatorRegistryPort,
  SettingsAdminPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { FastifyRequest } from 'fastify';
import type { InvoicePlacementApplyPort } from './ports/index.js';
import { invoicesModule, type InvoicesModuleOptions, type InvoicesModuleHandle } from './plugin.js';
import { CorrectiveInvoiceProvider } from './services/corrective-invoice.js';
import { InvoicePlacementApplyService } from './services/invoice-placement-apply-port.js';
import { InvoiceReadService, createInvoicePdfPort } from './services/invoice-read-port.js';
import type { InvoiceNumberGenerator } from './services/invoice-number-generator.js';
import { NumberingConfigurationService } from './services/numbering-configuration.js';
import { createNumberingPatternValidator } from './services/numbering-write-validator.js';
import { INVOICE_ISSUED_DEFAULT } from './email-templates/invoice-issued.default.js';

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
  readonly auditLogService: AuditPort;
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
  readonly invoicesNumberingConfiguration: NumberingConfigurationService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    /**
     * Feature 078, D-95.3 / D-95.4 — the boot-time numbering configuration.
     *
     * The `settingsAdminService` port is resolved here, inside the factory,
     * rather than from the boot hook: `settings` is non-deactivatable, so the
     * gate has no state in which it says no, but keeping the resolution at the
     * point of use is the rule the rest of the tree follows.
     */
    invoicesNumberingConfiguration: ctx
      .asFunction(({ emFactory }: InvoicesCradle) => {
        const settingsAdmin = lazyPort<SettingsAdminPort>(ctx, 'settingsAdminService');
        return new NumberingConfigurationService(emFactory, () => settingsAdmin, ctx.log);
      })
      .singleton(),

    // Contribution point, absent by default: no KSeF, no verification block.
    ksefVerificationResolver: ctx
      .asFunction((): InvoicesCradle['ksefVerificationResolver'] => undefined)
      .singleton(),

    invoices: ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: InvoicesCradle) => {
        const bridge = (): InvoicesBridge => ctx.cradle<InvoicesCradle>().invoicesBridge;
        const result = invoicesModule({
          emFactory,
          // Feature 075, Phase C — `orders`' published read model, resolved per
          // call. The five reads it replaces were `em.findOne(Order, …)` /
          // `em.find(OrderItem, …)` in this module's own services and routes:
          // deactivation drops no tables, so they kept answering out of an
          // `orders` an operator had switched off. `orders` is already a
          // binding dependency of this manifest and the edge stays fail-closed.
          orderReadPort: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
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
  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // Four inbound sites read the `Invoice` entity — `orders` twice, `ksef`
  // twice. `invoiceReadPort` is that read; `invoicePdfPort` is the document
  // surface `orders` renders from, and it is a port rather than a relocation
  // even though the two builders behind it are pure. See its note: the
  // question a document asks is Constitution XVII's, not FR-013's.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<InvoiceReadPort>(
    'invoiceReadPort',
    ctx.asFunction(({ emFactory }: InvoicesCradle) => new InvoiceReadService(emFactory)).singleton(),
  );

  ctx.di.providePort<InvoicePdfPort>(
    'invoicePdfPort',
    ctx.asFunction(() => createInvoicePdfPort()).singleton(),
  );

  /**
   * The proforma order placement opens, on the **caller's** `EntityManager`
   * (feature 080, T048; D-169).
   *
   * `orders` imported this module's `Invoice` class for it until T048 — a
   * co-transactional seam D-78 point 2 ruled permanent, held by
   * `invoices_order_fk` (`on delete restrict`): the row cannot exist before its
   * order does, and the order does not commit until placement returns. The
   * constraint and the transaction are unchanged; what moved is the statement,
   * to the module that owns the table. `InvoicePlacementApplyPort` is declared
   * in this module's `ports/` directory rather than in
   * `@endora-commerce/contracts`, because it takes a MikroORM `EntityManager`
   * and FR-034 keeps that package free of them.
   *
   * It is a **gated** registration like every other name here, which is the
   * half `orders` writing the row itself could never have: an operator who has
   * switched invoicing off now gets no proforma, instead of one written into a
   * switched-off module's table. `orders` declares the edge `degrades-without`
   * and asks presence before the call.
   */
  ctx.di.providePort<InvoicePlacementApplyPort>(
    'invoicePlacementApplyPort',
    ctx.asFunction(() => new InvoicePlacementApplyService()).singleton(),
  );

  ctx.di.providePort(
    'invoicePdfRenderer',
    ctx.asFunction(({ invoices }: InvoicesCradle) => invoices.handle.pdfRenderer).singleton(),
  );

  /**
   * The corrective invoice a return settlement issues (feature 046 / 047 US3),
   * as this module's port instead of a class both roots constructed (T143c).
   *
   * This is the entry the ledger was worth building for: the two roots built it
   * with **different** number generators. Production passed an accessor onto
   * `invoiceNumberGenerator`, the module's one instance; the harness built a
   * second `InvoiceNumberGenerator` over a second pattern resolver, so every
   * corrective number a test drew came out of a counter the module could not
   * see. One instance now, in both compositions, and it stops answering when
   * `invoices` is switched off — which a root's copy never did, correction
   * numbers and all.
   *
   * The generator is still reached through an accessor rather than
   * destructured: it is this module's own gated port, so resolving it while
   * this registration is built asks the gate at composition time, which is what
   * took the backend down for an operator who had switched the module off.
   */
  const numberGenerator = lazyPort<InvoiceNumberGenerator>(ctx, 'invoiceNumberGenerator');
  ctx.di.providePort<CorrectiveInvoicePort>(
    'correctiveInvoicePort',
    ctx
      .asFunction(
        ({ emFactory, eventBus, auditLogService }: InvoicesCradle) =>
          new CorrectiveInvoiceProvider(
            emFactory,
            () => numberGenerator,
            auditLogService,
            eventBus,
          ),
      )
      .singleton(),
  );

  /**
   * FR-002 — auto-issue on an order status change (issue #107).
   *
   * A bare `eventBus.on` here meant the heaviest write in the sweep that found
   * this: a switched-off `invoices` still issued a numbered legal document, took
   * a number out of the sequence and e-mailed the PDF, with no surface an
   * operator could see it on. `ctx.subscribe` gates it on the effective state.
   */
  ctx.subscribe('order.status_changed.v1', async (payload) => {
    await ctx
      .cradle<InvoicesCradle>()
      .invoices.handle.autoIssueReactor.onOrderStatusChanged(payload);
  });

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
    // Feature 075, Phase C — the registry's published shape. Still a
    // **contribution**, not a call: the classification in the
    // deactivation-consequence ledger is unchanged, and must be — the host
    // filters by contributor at enumeration, so this must not become an edge
    // that fails closed.
    const defaults = lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort');
    defaults.register('invoice_issued', INVOICE_ISSUED_DEFAULT, 'invoices');
  });

  /**
   * Feature 078, D-95.2 — the settings-write validator, a **contribution**.
   *
   * Deliberately its own hook, and deliberately without a presence probe. The
   * host filters by contributor at enumeration (`SettingWriteValidatorRegistry`
   * states the policy at the class), so probing here would make switching
   * `invoices` back on require a restart before its numbering rule applied
   * again. It is kept separate from the numbering-configuration hook below
   * because a hook that both works and contributes is a `mixed-boot-hook`, and
   * its remedy is to split it — never to probe the top of it.
   */
  ctx.onBoot(() => {
    const validators = lazyPort<SettingWriteValidatorRegistryPort>(
      ctx,
      'settingWriteValidatorRegistry',
    );
    validators.register(createNumberingPatternValidator());
  });

  /**
   * Feature 078, D-95.3 / D-95.4 — the grandfather write and the collision
   * report. A **working** hook, and it deliberately does not probe presence.
   *
   * The write is a one-time migration of this module's own configuration.
   * Activation is reversible and a migration is not, so gating it on an
   * operator's activation choice means a deployment that happened to have
   * `invoices` off during the upgrade gets the new `{channel}` default applied
   * to its first channel and its invoice numbers change shape. The entry in
   * `BOOT_HOOKS_WITHOUT_PRESENCE` says the same thing where the ledger is read.
   * The hook writes at most three rows, once, and does nothing on every later
   * boot.
   */
  ctx.onBoot(async () => {
    await ctx.cradle<InvoicesCradle>().invoicesNumberingConfiguration.reconcile();
  });

}
