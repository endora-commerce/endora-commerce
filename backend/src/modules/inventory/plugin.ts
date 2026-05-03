import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { AvailabilityNotificationService } from './services/availability-notification-service.js';
import { AvailabilityWorker } from './services/availability-worker.js';
import { CsvStockImporter } from './services/csv-stock-importer.js';
import { WarehouseService } from './services/warehouse-service.js';
import { StockLevelService } from './services/stock-level-service.js';
import { WarehouseChannelService } from './services/warehouse-channel-service.js';
import { ThresholdAdminService } from './services/threshold-admin-service.js';
import { LowStockAlertService } from './services/low-stock-alert-service.js';
import { registerInventoryRoutes } from './routes.js';
import { registerInventoryAdminRoutes } from './routes.admin.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { SalesChannelResolverService } from '../sales_channels/services/sales-channel-resolver.service.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import { ConsoleMailer, type Mailer } from '../email/services/mailer.js';

/**
 * Composition root for the inventory module — feature 010.
 *
 * Adds WarehouseService + StockLevelService alongside the existing
 * AvailabilityNotificationService. Routes are registered via the
 * plug-in factory so test harnesses get the same wiring.
 */
export interface InventoryModuleOptions {
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** When supplied, the admin stock-level read + set routes are registered. */
  requireAdmin?: RequireAdminFactory;
  /** Optional event bus for `inventory.adjusted.v1` emission. */
  eventBus?: EventBus;
  /** Optional channel resolver — when supplied, storefront-public stock
   *  reads scope cumulative on-hand to the caller's channel binding. */
  channelResolver?: SalesChannelResolverService;
  /** Optional settings service used to read the inventory.display_mode key
   *  for the storefront-public display-mode endpoint. */
  settingsService?: SettingsService;
  /** Optional mailer for low-stock alerts. Defaults to ConsoleMailer. */
  mailer?: Mailer;
  /** Channel id used to read inventory.* settings for low-stock alerts. */
  settingsChannelId?: string;
}

export function inventoryModule(options: InventoryModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const mailer = options.mailer ?? new ConsoleMailer();
    const availabilityService = new AvailabilityNotificationService(options.emFactory, mailer);
    const availabilityWorker = new AvailabilityWorker(options.emFactory, mailer);
    if (options.eventBus) availabilityWorker.attach(options.eventBus);
    const warehouseChannelService = new WarehouseChannelService(options.emFactory);
    const stockLevelService = new StockLevelService(options.emFactory, options.eventBus);
    const thresholdAdminService = new ThresholdAdminService(options.emFactory);
    const lowStockAlertService = new LowStockAlertService(
      options.emFactory,
      mailer,
      options.settingsService,
      options.settingsChannelId,
    );
    if (options.eventBus) {
      lowStockAlertService.attach(options.eventBus);
    }
    await registerInventoryRoutes(app, {
      emFactory: options.emFactory,
      availabilityService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      warehouseChannelService,
      stockLevelService,
      ...(options.channelResolver ? { channelResolver: options.channelResolver } : {}),
      ...(options.settingsService ? { settingsService: options.settingsService } : {}),
    });
    if (options.requireAdmin) {
      const warehouseService = new WarehouseService(options.emFactory);
      const csvStockImporter = new CsvStockImporter(options.emFactory, options.eventBus);
      await registerInventoryAdminRoutes(app, {
        emFactory: options.emFactory,
        warehouseService,
        stockLevelService,
        warehouseChannelService,
        thresholdAdminService,
        lowStockAlertService,
        availabilityNotificationService: availabilityService,
        csvStockImporter,
        requireAdmin: options.requireAdmin,
      });
    }
  };
}
