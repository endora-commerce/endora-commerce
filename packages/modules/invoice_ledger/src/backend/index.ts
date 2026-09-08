import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  INFAKT_INSTANCE_CREDENTIAL_CODE,
  INVOICE_COPY_HOST_PORT,
  INVOICE_KSEF_ASSIGNMENT_PORT,
  INVOICE_LEDGER_DELIVERY_PORT,
  INVOICE_LEDGER_DELIVERY_QUEUED_EVENT,
  INVOICE_LEDGER_MODULES,
  INVOICE_LEDGER_REGISTRY_PORT,
  INVOICE_LEDGER_ROUTING_PORT,
  INVOICE_LEDGER_WEBHOOK_PORT,
  INVOICE_NUMBERING_HOST_PORT,
  INVOICE_PAID_HOST_PORT,
  infaktEnvironmentSchema,
  invoiceCorrectedEventSchema,
  invoiceIssuedEventSchema,
  type CredentialsPort,
  type InvoiceCopyHostPort,
  type InvoiceKsefAssignmentPort,
  type InvoiceLedgerDeliveryPort,
  type InvoiceLedgerDeliveryQueuedEvent,
  type InvoiceLedgerRegistryPort,
  type InvoiceLedgerWebhookPort,
  type InvoiceNumberingHostPort,
  type InvoicePaidHostPort,
  infaktChannelCredentialCode,
  type InvoiceLedgerRoutingPort,
  type SettingsAdminPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import type { ModuleContext, RequireAdminFactory, SettingsReadPort } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import { registerInvoiceLedgerAdminRoutes } from './routes.admin.js';
import { InvoiceLedgerDeliveryAdminService } from './services/invoice-ledger-delivery-admin.service.js';
import { InvoiceLedgerRoutingWriteService } from './services/invoice-ledger-routing-write.service.js';
import { InvoiceLedgerActivationLock } from './entities/invoice-ledger-activation-lock.entity.js';
import { InvoiceLedgerClientMap } from './entities/invoice-ledger-client-map.entity.js';
import { InvoiceLedgerDelivery } from './entities/invoice-ledger-delivery.entity.js';
import { InvoiceLedgerDocumentMap } from './entities/invoice-ledger-document-map.entity.js';
import { InvoiceLedgerWebhookReceipt } from './entities/invoice-ledger-webhook-receipt.entity.js';
import {
  INVOICE_LEDGER_VENDOR_KSEF_ABSENT_MESSAGE,
  InvoiceLedgerDeliveryService,
} from './services/invoice-ledger-delivery.service.js';
import { InvoiceLedgerRegistryService } from './services/invoice-ledger-registry.service.js';
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
}

interface ModuleActivationChangedPayload {
  moduleId?: string;
  active?: boolean;
}

const LEDGER_VENDOR_IDS: ReadonlySet<string> = new Set(
  INVOICE_LEDGER_MODULES.map((entry) => entry.id),
);

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort<InvoiceLedgerRegistryPort>(
    INVOICE_LEDGER_REGISTRY_PORT,
    ctx
      .asFunction(({ emFactory }: LedgerCradle) => new InvoiceLedgerRegistryService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<InvoiceLedgerRoutingPort>(
    INVOICE_LEDGER_ROUTING_PORT,
    ctx
      .asFunction(() => {
        const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
        const registry = lazyPort<InvoiceLedgerRegistryPort>(ctx, INVOICE_LEDGER_REGISTRY_PORT);
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
    INVOICE_LEDGER_DELIVERY_PORT,
    ctx
      .asFunction(({ invoiceLedgerDeliveryService }: LedgerCradle) => invoiceLedgerDeliveryService)
      .singleton(),
  );

  ctx.di.providePort<InvoiceLedgerWebhookPort>(
    INVOICE_LEDGER_WEBHOOK_PORT,
    ctx
      .asFunction(({ emFactory }: LedgerCradle) => {
        const deliveries = lazyPort<InvoiceLedgerDeliveryPort>(ctx, INVOICE_LEDGER_DELIVERY_PORT);
        return new InvoiceLedgerWebhookService({
          emFactory,
          deliveries,
          numbering: lazyPort<InvoiceNumberingHostPort>(ctx, INVOICE_NUMBERING_HOST_PORT),
          paid: lazyPort<InvoicePaidHostPort>(ctx, INVOICE_PAID_HOST_PORT),
          ksefAssignment: lazyPort<InvoiceKsefAssignmentPort>(ctx, INVOICE_KSEF_ASSIGNMENT_PORT),
        });
      })
      .singleton(),
  );

  ctx.di.register({
    invoiceLedgerRoutingWrite: ctx
      .asFunction(({ emFactory, commandBus }: LedgerCradle) => {
        const settings = lazyPort<SettingsReadPort>(ctx, 'settingsReadPort');
        const registry = lazyPort<InvoiceLedgerRegistryPort>(ctx, INVOICE_LEDGER_REGISTRY_PORT);
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
          lazyPort<InvoiceCopyHostPort>(ctx, INVOICE_COPY_HOST_PORT),
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
    const routing = lazyPort<InvoiceLedgerRoutingPort>(ctx, INVOICE_LEDGER_ROUTING_PORT);
    const channelId = input.salesChannelId;
    const numberingMode = await routing.numberingModeFor(channelId);
    const ksefAction = await routing.nativeKsefActionFor(channelId);
    const ksefRouting = ksefAction === 'skip' ? 'vendor' : 'native';
    const adapterId = await routing.activeVendorModuleId();
    const deliveries = lazyPort<InvoiceLedgerDeliveryPort>(ctx, INVOICE_LEDGER_DELIVERY_PORT);
    if (!adapterId) {
      if (ksefRouting === 'vendor') {
        await deliveries.enqueueClosed(
          {
            adapterId: INVOICE_LEDGER_MODULES[0].id,
            invoiceId: input.invoiceId,
            kind: input.kind,
            salesChannelId: channelId,
            credentialCode: INFAKT_INSTANCE_CREDENTIAL_CODE,
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
    let credentialCode =
      adapterId === 'infakt' ? INFAKT_INSTANCE_CREDENTIAL_CODE : adapterId;
    const credentials = lazyPort<CredentialsPort>(ctx, 'credentialsService');
    if (adapterId === 'infakt' && channelId) {
      const overrideCode = infaktChannelCredentialCode(channelId);
      const override = await credentials.getByCode(overrideCode);
      if (override) credentialCode = overrideCode;
    }
    const stored = await credentials.getByCode(credentialCode);
    const envField = stored?.fields.find((field) => field.key === 'environment');
    const parsedEnv = infaktEnvironmentSchema.safeParse(envField?.value);
    const environment = parsedEnv.success ? parsedEnv.data : 'sandbox';

    const row = await deliveries.enqueue({
      adapterId,
      invoiceId: input.invoiceId,
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
    if (!LEDGER_VENDOR_IDS.has(event.moduleId)) return;
    const registry = lazyPort<InvoiceLedgerRegistryPort>(ctx, INVOICE_LEDGER_REGISTRY_PORT);
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
