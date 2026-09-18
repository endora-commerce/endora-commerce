import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CAPABILITY_KEYS,
  INVOICE_LEDGER_DELIVERY_QUEUED_EVENT,
  INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE,
  invoiceCorrectedEventSchema,
  invoiceIssuedEventSchema,
  type InvoiceCopyHostPort,
  type InvoiceKsefAssignmentPort,
  type InvoiceLedgerDeliveryPort,
  type InvoiceLedgerDeliveryQueuedEvent,
  type InvoiceLedgerRegistryPort,
  type InvoiceLedgerVendorFreezeRegistryPort,
  type InvoiceLedgerWebhookPort,
  type InvoiceNumberingHostPort,
  type InvoicePaidHostPort,
  type InvoiceLedgerRoutingPort,
  type SettingsAdminPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import type { ModuleContext, RequireAdminFactory, SettingsReadPort } from '@endora-commerce/platform/kernel';
import { effectiveState, lazyPort } from '@endora-commerce/platform/kernel';
import { registerInvoiceLedgerAdminRoutes } from './routes.admin.js';
import { InvoiceLedgerDeliveryAdminService } from './services/invoice-ledger-delivery-admin.service.js';
import { InvoiceLedgerRoutingWriteService } from './services/invoice-ledger-routing-write.service.js';
import { InvoiceLedgerActivationLock } from './entities/invoice-ledger-activation-lock.entity.js';
import { InvoiceLedgerClientMap } from './entities/invoice-ledger-client-map.entity.js';
import { InvoiceLedgerDelivery } from './entities/invoice-ledger-delivery.entity.js';
import { InvoiceLedgerDocumentMap } from './entities/invoice-ledger-document-map.entity.js';
import { InvoiceLedgerWebhookReceipt } from './entities/invoice-ledger-webhook-receipt.entity.js';
import { InvoiceLedgerDeliveryService } from './services/invoice-ledger-delivery.service.js';
import { InvoiceLedgerVendorFreezeRegistry } from './services/invoice-ledger-vendor-freeze-registry.js';
import {
  declaredLedgerVendorModules,
  defaultInvoiceLedgerPresence,
  InvoiceLedgerRegistryService,
  type LedgerActivationPresenceReader,
} from './services/invoice-ledger-registry.service.js';
import { InvoiceLedgerRoutingService } from './services/invoice-ledger-routing.service.js';
import { InvoiceLedgerWebhookService } from './services/invoice-ledger-webhook.service.js';

type LedgerEvents = Record<string, EventBase> & {
  [INVOICE_LEDGER_DELIVERY_QUEUED_EVENT]: InvoiceLedgerDeliveryQueuedEvent;
};

interface LedgerCradle {
  readonly requireAdmin: RequireAdminFactory;
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus<LedgerEvents>;
  readonly commandBus: CommandBus;
  readonly invoiceLedgerRoutingWrite: InvoiceLedgerRoutingWriteService;
  readonly invoiceLedgerDeliveryService: InvoiceLedgerDeliveryService;
  readonly invoiceLedgerDeliveryAdmin: InvoiceLedgerDeliveryAdminService;
  readonly invoiceLedgerPresence: LedgerActivationPresenceReader;
  /**
   * The vendor family. A **function** in production since feature 132 — the
   * derivation is re-installed by every module-state refresh, so a value read once
   * would answer for the deployment as it was at composition. A caller that means
   * "these vendors, whatever the deployment says" still registers a plain array,
   * which is the seam the test harness uses to add a sibling it does not ship.
   */
  readonly invoiceLedgerVendorModules:
    | readonly { id: string }[]
    | (() => readonly { id: string }[]);
  readonly invoiceLedgerVendorFreezeRegistry: InvoiceLedgerVendorFreezeRegistryPort;
}

interface ModuleActivationChangedPayload {
  moduleId?: string;
  active?: boolean;
}

/**
 * Feature 132 (T026) — the vendor family, derived, read at the moment it is asked.
 *
 * This was a module-level `Set` built from `INVOICE_LEDGER_MODULES` at import
 * time. Both halves of that were wrong once the family became a declaration: the
 * population came from a hand-written array a vendor outside this repository
 * cannot edit, and the `Set` was frozen at import, while the derived family is
 * re-installed by every `b2b:module:state-changed` refresh.
 *
 * **Declared** membership, not effective: this answers "is the module this event
 * names one of mine", and on a *deactivation* the vendor is already absent — an
 * effective-presence test would drop exactly the event that has to clear the lock.
 */
/**
 * The adapter a **dead-lettered** delivery is attributed to when no vendor is
 * active at all and KSeF routing is `vendor` — the row shape requires an
 * `adapterId` and there is, by construction, no adapter.
 *
 * It was `INVOICE_LEDGER_MODULES[0].id`, i.e. "whichever vendor happened to be
 * first in a hand-written array", and deleting the array forces the placeholder to
 * be named rather than inherited. This keeps today's semantics exactly — the first
 * **declared** member of the family, which is the same module in this tree — and
 * falls back to this module's own id when the deployment ships no vendor at all, a
 * state the array could not represent. Attributing a no-vendor failure to an
 * arbitrary vendor is a wart either way; it is recorded here rather than moved, and
 * `specs/132-connector-family-discovery/tasks.md` T028 carries it for the owner.
 */
function deadLetterAdapterId(): string {
  return declaredLedgerVendorModules()[0]?.id ?? 'invoice_ledger';
}

function isLedgerVendor(moduleId: string): boolean {
  return effectiveState
    .declaredMembersOfCapability(CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR)
    .includes(moduleId);
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    invoiceLedgerPresence: ctx.asValue(defaultInvoiceLedgerPresence),
    // Feature 132 (T026) — the seam that was already open, now supplied by the
    // derivation instead of by an imported array. A **function**, so a refresh that
    // adds or removes a member is answered rather than out-lived; the harness still
    // overrides this name with an explicit list to add a sibling it does not ship.
    invoiceLedgerVendorModules: ctx.asValue(declaredLedgerVendorModules),
    invoiceLedgerVendorFreezeRegistry: ctx
      .asFunction(() => new InvoiceLedgerVendorFreezeRegistry())
      .singleton(),
  });
  ctx.di.providePort<InvoiceLedgerRegistryPort>(
    'invoiceLedgerRegistryPort',
    ctx
      .asFunction(
        ({ emFactory, invoiceLedgerPresence, invoiceLedgerVendorModules }: LedgerCradle) =>
          new InvoiceLedgerRegistryService(
            emFactory,
            invoiceLedgerPresence,
            invoiceLedgerVendorModules,
          ),
      )
      .singleton(),
  );

  ctx.di.providePort<InvoiceLedgerRoutingPort>(
    'invoiceLedgerRoutingPort',
    ctx
      .asFunction(() => {
        const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
        const registry = lazyPort<InvoiceLedgerRegistryPort>(ctx, 'invoiceLedgerRegistryPort');
        return new InvoiceLedgerRoutingService(settings, registry);
      })
      .singleton(),
  );

  ctx.di.register({
    invoiceLedgerDeliveryService: ctx
      .asFunction(({ emFactory }: LedgerCradle) => new InvoiceLedgerDeliveryService(emFactory))
      .singleton(),
  });

  ctx.di.providePort<InvoiceLedgerDeliveryPort>(
    'invoiceLedgerDeliveryPort',
    ctx
      .asFunction(({ invoiceLedgerDeliveryService }: LedgerCradle) => invoiceLedgerDeliveryService)
      .singleton(),
  );

  ctx.di.providePort<InvoiceLedgerWebhookPort>(
    'invoiceLedgerWebhookPort',
    ctx
      .asFunction(({ emFactory }: LedgerCradle) => {
        const deliveries = lazyPort<InvoiceLedgerDeliveryPort>(ctx, 'invoiceLedgerDeliveryPort');
        return new InvoiceLedgerWebhookService({
          emFactory,
          deliveries,
          numbering: lazyPort<InvoiceNumberingHostPort>(ctx, 'invoiceNumberingHostPort'),
          paid: lazyPort<InvoicePaidHostPort>(ctx, 'invoicePaidHostPort'),
          ksefAssignment: lazyPort<InvoiceKsefAssignmentPort>(ctx, 'invoiceKsefAssignmentPort'),
        });
      })
      .singleton(),
  );

  ctx.di.register({
    invoiceLedgerRoutingWrite: ctx
      .asFunction(({ emFactory, commandBus }: LedgerCradle) => {
        const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
        const registry = lazyPort<InvoiceLedgerRegistryPort>(ctx, 'invoiceLedgerRegistryPort');
        const routing = new InvoiceLedgerRoutingService(settings, registry);
        return new InvoiceLedgerRoutingWriteService(
          routing,
          lazyPort<SettingsAdminPort>(ctx, 'settingsAdminService'),
          emFactory,
          commandBus,
        );
      })
      .singleton(),
    invoiceLedgerDeliveryAdmin: ctx
      .asFunction(({ invoiceLedgerDeliveryService, commandBus, eventBus }: LedgerCradle) => {
        return new InvoiceLedgerDeliveryAdminService(
          invoiceLedgerDeliveryService,
          lazyPort<InvoiceCopyHostPort>(ctx, 'invoiceCopyHostPort'),
          commandBus,
          eventBus,
        );
      })
      .singleton(),
  });

  async function enqueueFromInvoiceEvent(input: {
    invoiceId: string;
    kind: 'invoice' | 'correction';
    salesChannelId: string | null;
  }): Promise<void> {
    // The buyer organization, first and outside every other read: it is the
    // delivery row's own tenant key since the two ledger tables stopped hanging
    // off `Invoice` (`invoice-ledger-delivery.entity.ts` has the reasoning),
    // and a row cannot be written without one — Principle XI has no
    // "no organization" path. The copy port is the only way this module learns
    // anything about an invoice, and it is the same `invoiceCopyHostPort` the
    // delivery list already reads. It returning nothing is a state with nothing
    // to enqueue rather than a refusal to report: either `invoices` is absent,
    // in which case it emitted no event and this function was not reached, or
    // the invoice this event names is gone, and a work item for an invoice that
    // is not there has nothing to deliver.
    const copies = lazyPort<InvoiceCopyHostPort>(ctx, 'invoiceCopyHostPort');
    const copy = await copies.getById(input.invoiceId);
    if (copy === null) return;
    const organizationId = copy.organizationId;
    const routing = lazyPort<InvoiceLedgerRoutingPort>(ctx, 'invoiceLedgerRoutingPort');
    const channelId = input.salesChannelId;
    const numberingMode = await routing.numberingModeFor(channelId);
    const ksefAction = await routing.nativeKsefActionFor(channelId);
    const ksefRouting = ksefAction === 'skip' ? 'vendor' : 'native';
    const adapterId = await routing.activeVendorModuleId();
    const deliveries = lazyPort<InvoiceLedgerDeliveryPort>(ctx, 'invoiceLedgerDeliveryPort');
    if (!adapterId) {
      if (ksefRouting === 'vendor') {
        await deliveries.enqueueClosed(
          {
            adapterId: deadLetterAdapterId(),
            invoiceId: input.invoiceId,
            organizationId,
            kind: input.kind,
            salesChannelId: channelId,
            credentialCode: deadLetterAdapterId(),
            environment: 'sandbox',
            numberingMode,
            ksefRouting,
            ksefDelegated: true,
          },
          INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE,
          { dead: true },
        );
      }
      return;
    }
    const freeze = ctx.cradle<LedgerCradle>().invoiceLedgerVendorFreezeRegistry;
    const frozen = (await freeze.resolve(adapterId, channelId)) ?? {
      credentialCode: adapterId,
      environment: 'sandbox' as const,
    };
    const { credentialCode, environment } = frozen;

    const row = await deliveries.enqueue({
      adapterId,
      invoiceId: input.invoiceId,
      organizationId,
      kind: input.kind,
      salesChannelId: channelId,
      credentialCode,
      environment,
      numberingMode,
      ksefRouting,
      ksefDelegated: ksefRouting === 'vendor',
    });
    ctx.cradle<LedgerCradle>().eventBus.emit(INVOICE_LEDGER_DELIVERY_QUEUED_EVENT, {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      deliveryId: row.id,
      adapterId,
    });
  }

  ctx.subscribe('invoice.issued.v1', async (payload) => {
    const parsed = invoiceIssuedEventSchema.safeParse(payload);
    if (!parsed.success) return;
    if (parsed.data.kind === 'proforma') return;
    await enqueueFromInvoiceEvent({
      invoiceId: parsed.data.invoiceId,
      kind: 'invoice',
      salesChannelId: parsed.data.salesChannelId,
    });
  });

  ctx.subscribe('invoice.corrected.v1', async (payload) => {
    const parsed = invoiceCorrectedEventSchema.safeParse(payload);
    if (!parsed.success) return;
    await enqueueFromInvoiceEvent({
      invoiceId: parsed.data.invoiceId,
      kind: 'correction',
      salesChannelId: parsed.data.salesChannelId,
    });
  });

  ctx.subscribe('module.activation.changed', async (payload) => {
    const event = payload as ModuleActivationChangedPayload;
    if (typeof event.moduleId !== 'string' || typeof event.active !== 'boolean') return;
    if (!isLedgerVendor(event.moduleId)) return;
    const registry = lazyPort<InvoiceLedgerRegistryPort>(ctx, 'invoiceLedgerRegistryPort');
    if (event.active) {
      await registry.recordActive(event.moduleId, null);
    } else {
      await registry.clearActive(event.moduleId);
    }
  });

  ctx.routes(async (app) => {
    const { requireAdmin, invoiceLedgerRoutingWrite, invoiceLedgerDeliveryAdmin } =
      ctx.cradle<LedgerCradle>();
    await registerInvoiceLedgerAdminRoutes(app, {
      requireAdmin,
      routingWrite: invoiceLedgerRoutingWrite,
      deliveries: invoiceLedgerDeliveryAdmin,
    });
  });
}

export const entities = [
  InvoiceLedgerActivationLock,
  InvoiceLedgerClientMap,
  InvoiceLedgerDocumentMap,
  InvoiceLedgerDelivery,
  InvoiceLedgerWebhookReceipt,
];

export { InvoiceLedgerRegistryService } from './services/invoice-ledger-registry.service.js';
export { InvoiceLedgerRoutingService } from './services/invoice-ledger-routing.service.js';
export { InvoiceLedgerDeliveryService } from './services/invoice-ledger-delivery.service.js';
