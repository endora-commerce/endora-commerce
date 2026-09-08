import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  INFAKT_INSTANCE_CREDENTIAL_CODE,
  INVOICE_LEDGER_DELIVERY_PORT,
  INVOICE_LEDGER_DELIVERY_QUEUED_EVENT,
  INVOICE_LEDGER_MODULES,
  INVOICE_LEDGER_READ_PERMISSION,
  INVOICE_LEDGER_REGISTRY_PORT,
  INVOICE_LEDGER_ROUTING_PORT,
  infaktEnvironmentSchema,
  invoiceIssuedEventSchema,
  type CredentialsPort,
  type InvoiceLedgerDeliveryPort,
  type InvoiceLedgerDeliveryQueuedEvent,
  type InvoiceLedgerRegistryPort,
  type InvoiceLedgerRoutingPort,
} from '@endora-commerce/contracts';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import type { ModuleContext, RequireAdminFactory, SettingsReadPort } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import { InvoiceLedgerActivationLock } from './entities/invoice-ledger-activation-lock.entity.js';
import { InvoiceLedgerClientMap } from './entities/invoice-ledger-client-map.entity.js';
import { InvoiceLedgerDelivery } from './entities/invoice-ledger-delivery.entity.js';
import { InvoiceLedgerDocumentMap } from './entities/invoice-ledger-document-map.entity.js';
import { InvoiceLedgerWebhookReceipt } from './entities/invoice-ledger-webhook-receipt.entity.js';
import { InvoiceLedgerDeliveryService } from './services/invoice-ledger-delivery.service.js';
import { InvoiceLedgerRegistryService } from './services/invoice-ledger-registry.service.js';
import { InvoiceLedgerRoutingService } from './services/invoice-ledger-routing.service.js';

type LedgerEvents = Record<string, EventBase> & {
  [INVOICE_LEDGER_DELIVERY_QUEUED_EVENT]: InvoiceLedgerDeliveryQueuedEvent;
};

interface LedgerCradle {
  readonly requireAdmin: RequireAdminFactory;
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus<LedgerEvents>;
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

  ctx.di.providePort<InvoiceLedgerDeliveryPort>(
    INVOICE_LEDGER_DELIVERY_PORT,
    ctx
      .asFunction(({ emFactory }: LedgerCradle) => new InvoiceLedgerDeliveryService(emFactory))
      .singleton(),
  );

  ctx.subscribe('invoice.issued.v1', async (payload) => {
    const parsed = invoiceIssuedEventSchema.safeParse(payload);
    if (!parsed.success) return;
    if (parsed.data.kind === 'proforma') return;
    const routing = lazyPort<InvoiceLedgerRoutingPort>(ctx, INVOICE_LEDGER_ROUTING_PORT);
    const adapterId = await routing.activeVendorModuleId();
    if (!adapterId) return;

    const channelId = parsed.data.salesChannelId;
    const numberingMode = await routing.numberingModeFor(channelId);
    const ksefAction = await routing.nativeKsefActionFor(channelId);
    const ksefRouting = ksefAction === 'skip' ? 'vendor' : 'native';
    const credentialCode =
      adapterId === 'infakt' ? INFAKT_INSTANCE_CREDENTIAL_CODE : adapterId;
    const credentials = lazyPort<CredentialsPort>(ctx, 'credentialsService');
    const stored = await credentials.getByCode(credentialCode);
    const envField = stored?.fields.find((field) => field.key === 'environment');
    const parsedEnv = infaktEnvironmentSchema.safeParse(envField?.value);
    const environment = parsedEnv.success ? parsedEnv.data : 'sandbox';

    const deliveries = lazyPort<InvoiceLedgerDeliveryPort>(ctx, INVOICE_LEDGER_DELIVERY_PORT);
    const row = await deliveries.enqueue({
      adapterId,
      invoiceId: parsed.data.invoiceId,
      kind: 'invoice',
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
    const { requireAdmin } = ctx.cradle<LedgerCradle>();
    const read = { preHandler: requireAdmin(INVOICE_LEDGER_READ_PERMISSION) };
    app.get('/api/v1/admin/invoice-ledger/deliveries', read, async (_request, reply) => {
      return reply.send({ data: [] });
    });
    app.get('/api/v1/admin/invoice-ledger/routing', read, async (_request, reply) => {
      const routing = lazyPort<InvoiceLedgerRoutingPort>(ctx, INVOICE_LEDGER_ROUTING_PORT);
      return reply.send({
        data: {
          numberingMode: await routing.numberingModeFor(null),
          ksefRouting:
            (await routing.nativeKsefActionFor(null)) === 'skip' ? 'vendor' : 'native',
          activeVendorModuleId: await routing.activeVendorModuleId(),
          channelOverrides: [],
        },
      });
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
