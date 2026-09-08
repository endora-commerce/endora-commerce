import type { EntityManager } from '@mikro-orm/postgresql';
import {
  INVOICE_LEDGER_DELIVERY_PORT,
  INVOICE_LEDGER_MODULES,
  INVOICE_LEDGER_READ_PERMISSION,
  INVOICE_LEDGER_REGISTRY_PORT,
  INVOICE_LEDGER_ROUTING_PORT,
  type InvoiceLedgerDeliveryPort,
  type InvoiceLedgerRegistryPort,
  type InvoiceLedgerRoutingPort,
} from '@endora-commerce/contracts';
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

interface LedgerCradle {
  readonly requireAdmin: RequireAdminFactory;
  readonly emFactory: () => EntityManager;
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
