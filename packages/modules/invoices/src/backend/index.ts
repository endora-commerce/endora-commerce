import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { EventBus } from '@endora-commerce/platform/events';
import type {
  AssetReadPort,
  AssetsLibraryPort,
  CorrectiveInvoicePort,
  CustomerAccountReadPort,
  EmailDefaultsRegistryPort,
  ErpSaleDocumentWritePort,
  InvoiceCopyHostPort,
  InvoiceKsefAssignmentPort,
  InvoiceNumberingHostPort,
  InvoicePaidHostPort,
  InvoiceLedgerRoutingPort,
  InvoicePdfPort,
  InvoiceReadPort,
  OrderReadPort,
  SettingWriteValidatorRegistryPort,
  SettingsAdminPort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { effectiveState, lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { FastifyRequest } from 'fastify';
import type { InvoicePlacementApplyPort } from '../ports/index.js';
import { invoicesModule, type InvoicesModuleOptions, type InvoicesModuleHandle } from './plugin.js';
import { CorrectiveInvoiceProvider } from './services/corrective-invoice.js';
import { ErpSaleDocumentWritePortService } from './services/erp-sale-document-write-port.js';
import { InvoiceAttachmentFetchRegistry } from './services/invoice-attachment-fetch-registry.js';
import { InvoicePlacementApplyService } from './services/invoice-placement-apply-port.js';
import { InvoiceCopyHostService } from './services/invoice-copy-host.service.js';
import { InvoiceReadService, createInvoicePdfPort } from './services/invoice-read-port.js';
import type { InvoiceNumberGenerator } from './services/invoice-number-generator.js';
import { NumberingConfigurationService } from './services/numbering-configuration.js';
import { createNumberingPatternValidator } from './services/numbering-write-validator.js';
import {
  createAssetImageLoader,
  createChannelLanguageResolver,
  createRecipientEmailResolver,
} from './services/cross-module-context.js';
import { INVOICE_ISSUED_DEFAULT } from './email-templates/invoice-issued.default.js';
import { InvoiceExternalAttachment } from './entities/invoice-external-attachment.entity.js';
import { InvoiceLine } from './entities/invoice-line.entity.js';
import { InvoiceNumberCounter } from './entities/invoice-number-counter.entity.js';
import { InvoiceTemplate } from './entities/invoice-template.entity.js';
import { Invoice } from './entities/invoice.entity.js';

/**
 * `invoices` — a document module with a late-bound verifier (feature 072,
 * wave 2, T113).
 *
 * **`InvoicesBridge` is gone** (`specs/110-instance-repository/` T118c). Six
 * options used to be one contributed object — naming the acting admin,
 * resolving the calling customer, finding the transactional e-mail sender and a
 * recipient address, picking a channel's language, and loading logo bytes from
 * `assets_library` — written as closures in `backend/src/composition.ts` and
 * again in `backend/test/helpers/test-server.ts`. Re-derived member by member,
 * none was a composition's answer to give:
 *
 *  - the acting admin and the calling customer are the platform's own
 *    `adminContextResolver` and `customerContextResolver`, read from the
 *    cradle, which is what every other module that takes a request actor does;
 *  - the transactional sender is `transactional_emails`' published
 *    `transactionalEmailSenderAccessor`, an accessor because that module
 *    announces its sender later than this one composes;
 *  - the recipient address is `customer_accounts`' published record, the
 *    channel's language a read of the platform's own entity, and the logo bytes
 *    `assets_library`' `assetReadPort` — all three in
 *    `services/cross-module-context.ts`, so the mappings are testable with
 *    nothing composed.
 *
 * Five of the six were **optional** options, and the harness omitted one of
 * them entirely (D-223). They are required now: an option no composition may
 * decline to supply is not an option, and typing one as omittable leaves a
 * branch no test can drive.
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

export interface InvoicesCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  readonly settingsReadPort: InvoicesModuleOptions['settingsService'];
  /** Platform-owned name — how this composition names the acting admin. */
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  /** Platform-owned name — how this composition names the calling customer. */
  readonly customerContextResolver: (
    req: FastifyRequest,
  ) => { customerAccountId: string; organizationId: string };
  /**
   * `transactional_emails`' late-bound sender, read per send. It answers
   * `undefined` until that module announces it, which is later than this module
   * composes — the reason it is an accessor rather than the sender itself.
   */
  readonly transactionalEmailSenderAccessor: () => TransactionalEmailSender | undefined;
  /** Absent on a deployment without KSeF; the PDF then carries no verification block. */
  readonly ksefVerificationResolver:
    | Parameters<InvoicesModuleHandle['pdfRenderer']['setKsefVerificationResolver']>[0]
    | undefined;
  readonly invoiceAttachmentFetchRegistry: InvoiceAttachmentFetchRegistry;
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

    /**
     * Feature 134, T061 (`research.md` D12) — the ERP attachment fetch seam, a
     * **contribution registry** and a plain `di.register` on purpose. A
     * connector pushes its provider from `ctx.onBoot`, which runs whatever this
     * module's effective state is, so a `providePort` gate here would stop the
     * backend from starting for an operator who switched invoicing off. The
     * presence question is answered per download, keyed on the contributor
     * recorded with each provider; the policy is stated at the class.
     */
    invoiceAttachmentFetchRegistry: ctx
      .asFunction(({ emFactory }: InvoicesCradle) => {
        const context = new ErpSaleDocumentWritePortService(emFactory);
        return new InvoiceAttachmentFetchRegistry(
          (input) => context.resolveAttachmentContext(input),
          (moduleId) => effectiveState.isPresent(moduleId),
        );
      })
      .singleton(),

    // Contribution point, absent by default: no KSeF, no verification block.
    ksefVerificationResolver: ctx
      .asFunction((): InvoicesCradle['ksefVerificationResolver'] => undefined)
      .singleton(),

    invoices: ctx
      .asFunction(({ emFactory, eventBus, auditLogService }: InvoicesCradle) => {
        const cradle = (): InvoicesCradle => ctx.cradle<InvoicesCradle>();
        const result = invoicesModule({
          emFactory,
          // Feature 075, Phase C — `orders`' published read model, resolved per
          // call. The five reads it replaces were `em.findOne(Order, …)` /
          // `em.find(OrderItem, …)` in this module's own services and routes:
          // deactivation drops no tables, so they kept answering out of an
          // `orders` an operator had switched off. `orders` is already a
          // binding dependency of this manifest and the edge stays fail-closed.
          orderReadPort: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
          assetReadPort: lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
          assetsLibrary: lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort'),
          // Feature 134, T061 — this module's own registry, not a connector's
          // port: it dispatches on the document's source system and answers
          // `null` for a provider that is absent, off or unknown.
          saleDocumentAttachments: cradle().invoiceAttachmentFetchRegistry,
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
          // T118c — the platform's own actor resolvers, read per request. Both
          // were `invoicesBridge` members spelling the identical closure in two
          // roots: `resolveAdminUserId` was `adminContextResolver(req).adminUserId`
          // in `composition.ts` verbatim, and `resolveCustomerContext` was
          // `customerContextResolver(req)` minus the impersonator field this
          // module does not read. That is the shape `mfa` found in two of its
          // six members and `pwa` in one of its eight.
          resolveAdminUserId: (req) => cradle().adminContextResolver(req).adminUserId,
          resolveCustomerContext: (req) => cradle().customerContextResolver(req),
          // Read per send: `transactional_emails` announces its sender after
          // this module composes, so the accessor is the value and the sender
          // is whatever it answers at the moment the e-mail goes out.
          getTransactionalEmailSender: () => cradle().transactionalEmailSenderAccessor(),
          resolveRecipientEmail: createRecipientEmailResolver(
            lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          ),
          resolveLanguage: createChannelLanguageResolver(emFactory),
          loadAssetImage: createAssetImageLoader(lazyPort<AssetReadPort>(ctx, 'assetReadPort')),
          ledgerRouting: {
            numberingModeFor: async (salesChannelId) => {
              if (!effectiveState.isPresent('invoice_ledger')) return 'endora';
              return lazyPort<InvoiceLedgerRoutingPort>(
                ctx,
                'invoiceLedgerRoutingPort',
              ).numberingModeFor(salesChannelId);
            },
            activeVendorModuleId: async () => {
              if (!effectiveState.isPresent('invoice_ledger')) return null;
              return lazyPort<InvoiceLedgerRoutingPort>(
                ctx,
                'invoiceLedgerRoutingPort',
              ).activeVendorModuleId();
            },
          },
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
  ctx.di.providePort<InvoiceNumberingHostPort>(
    'invoiceNumberingHostPort',
    ctx.asFunction(({ invoices }: InvoicesCradle) => invoices.handle.invoiceService).singleton(),
  );
  ctx.di.providePort<InvoicePaidHostPort>(
    'invoicePaidHostPort',
    ctx.asFunction(({ invoices }: InvoicesCradle) => invoices.handle.invoiceService).singleton(),
  );
  ctx.di.providePort<InvoiceKsefAssignmentPort>(
    'invoiceKsefAssignmentPort',
    ctx.asFunction(({ invoices }: InvoicesCradle) => invoices.handle.invoiceService).singleton(),
  );
  ctx.di.providePort<InvoiceCopyHostPort>(
    'invoiceCopyHostPort',
    ctx
      .asFunction(({ emFactory }: InvoicesCradle) => {
        const orders = lazyPort<OrderReadPort>(ctx, 'orderReadPort');
        return new InvoiceCopyHostService(emFactory, orders);
      })
      .singleton(),
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

  ctx.di.providePort<ErpSaleDocumentWritePort>(
    'erpSaleDocumentWritePort',
    ctx
      .asFunction(({ emFactory }: InvoicesCradle) => new ErpSaleDocumentWritePortService(emFactory))
      .singleton(),
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
            {
              numberingModeFor: async (salesChannelId) => {
                if (!effectiveState.isPresent('invoice_ledger')) return 'endora';
                return lazyPort<InvoiceLedgerRoutingPort>(
                  ctx,
                  'invoiceLedgerRoutingPort',
                ).numberingModeFor(salesChannelId);
              },
              activeVendorModuleId: async () => {
                if (!effectiveState.isPresent('invoice_ledger')) return null;
                return lazyPort<InvoiceLedgerRoutingPort>(
                  ctx,
                  'invoiceLedgerRoutingPort',
                ).activeVendorModuleId();
              },
            },
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

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  InvoiceLine,
  InvoiceNumberCounter,
  InvoiceTemplate,
  InvoiceExternalAttachment,
  Invoice,
];
