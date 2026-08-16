import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { AvailabilityNotificationService } from './services/availability-notification-service.js';
import { AvailabilityWorker } from './services/availability-worker.js';
import { CsvStockImporter } from './services/csv-stock-importer.js';
import { ThresholdSettingsMirror } from './services/threshold-settings-mirror.js';
import { WarehouseService } from './services/warehouse-service.js';
import { StockLevelService } from './services/stock-level-service.js';
import { WarehouseChannelService } from './services/warehouse-channel-service.js';
import { ThresholdAdminService } from './services/threshold-admin-service.js';
import { LowStockAlertService, type InventoryTemplateEmailPort } from './services/low-stock-alert-service.js';
import { registerInventoryRoutes } from './routes.js';
import { registerInventoryAdminRoutes } from './routes.admin.js';
import type { SalesChannelResolverService } from '../../kernel/sales-channels/sales-channel-resolver.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { ConsoleMailer, type Mailer } from '../email/services/mailer.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { DictionaryValidator } from '@b2b/contracts';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface InventoryAuditContext {
  actorAdminUserId: string;
  impersonatedCustomerAccountId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

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
  /** Feature 047 — optional admin-editable template path for inventory emails. */
  templateEmail?: InventoryTemplateEmailPort;
  /** Channel id used to read inventory.* settings for low-stock alerts. */
  settingsChannelId?: string;
  /** Lazy lookup for the system-default channel id; used by the
   *  threshold-settings mirror. Falls back to {@link channelResolver}
   *  when omitted. */
  resolveSystemDefaultChannelId?: () => Promise<string | null>;
  dictionaryValidator?: DictionaryValidator;
  /** Feature 024 — optional cross-module hook so warehouse / stock /
   *  threshold / CSV-import mutations land in the audit log. Tests that
   *  don't care about audit can omit it. */
  auditLogService?: AuditLogService;
  /** Feature 024 — resolves the admin actor identity for audit entries. */
  resolveAdminAuditContext?: (request: FastifyRequest) => {
    actorAdminUserId: string;
    impersonatedCustomerAccountId?: string | null;
  };
  /**
   * Feature 026 US4 — when provided, the storefront stock-figure endpoint
   * intersects its candidate warehouse set with the Organization's assigned
   * warehouses. Empty / null ⇒ platform defaults apply.
   */
  resolveOrganizationWarehouseAllowList?: (req: FastifyRequest) => Promise<string[] | null>;
}

/**
 * The three event handlers this module owns, exposed so `backend.ts` can
 * register them through `ctx.subscribe` (issue #107).
 *
 * They were attached here with a bare `eventBus.on`, which is why a switched-off
 * `inventory` still mailed back-in-stock notices, still mailed low-stock alerts
 * and still wrote the mirrored threshold row.
 */
export interface InventoryModuleHandle {
  availabilityWorker: AvailabilityWorker;
  lowStockAlertService: LowStockAlertService;
  /** Absent when this composition wired no settings service. */
  thresholdSettingsMirror: ThresholdSettingsMirror | undefined;
}

export interface InventoryModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: InventoryModuleHandle;
}

export function inventoryModule(options: InventoryModuleOptions): InventoryModuleResult {
  const mailer = options.mailer ?? new ConsoleMailer();
  const availabilityWorker = new AvailabilityWorker(options.emFactory, mailer);
  const lowStockAlertService = new LowStockAlertService(
    options.emFactory,
    mailer,
    options.settingsService,
    options.settingsChannelId,
    options.templateEmail,
  );

  let thresholdSettingsMirror: ThresholdSettingsMirror | undefined;
  if (options.settingsService) {
    // D-48 — the last branch used to be `sysDefault?.id ?? null`, which
    // mirrored the threshold settings platform-wide on a branch the platform
    // guarantees against. `null` here now means only what it always should
    // have: this composition wired no channel resolver at all.
    const resolveChannelId =
      options.resolveSystemDefaultChannelId ??
      (async (): Promise<string | null> => {
        if (options.settingsChannelId) return options.settingsChannelId;
        if (!options.channelResolver) return null;
        return (await options.channelResolver.getSystemDefault()).id;
      });
    thresholdSettingsMirror = new ThresholdSettingsMirror(
      options.emFactory,
      options.settingsService,
      resolveChannelId,
    );
  }

  const plugin = async (app: FastifyInstance): Promise<void> => {
    const availabilityService = new AvailabilityNotificationService(
      options.emFactory,
      mailer,
      options.templateEmail,
    );
    const warehouseChannelService = new WarehouseChannelService(
      options.emFactory,
      options.auditLogService,
    );
    const stockLevelService = new StockLevelService(
      options.emFactory,
      options.eventBus,
      options.auditLogService,
    );
    const thresholdAdminService = new ThresholdAdminService(
      options.emFactory,
      options.auditLogService,
    );
    await registerInventoryRoutes(app, {
      emFactory: options.emFactory,
      availabilityService,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      warehouseChannelService,
      stockLevelService,
      ...(options.channelResolver ? { channelResolver: options.channelResolver } : {}),
      ...(options.settingsService ? { settingsService: options.settingsService } : {}),
      ...(options.resolveOrganizationWarehouseAllowList
        ? { resolveOrganizationWarehouseAllowList: options.resolveOrganizationWarehouseAllowList }
        : {}),
    });
    if (options.requireAdmin) {
      const warehouseService = new WarehouseService(
        options.emFactory,
        options.dictionaryValidator,
        options.auditLogService,
      );
      const csvStockImporter = new CsvStockImporter(
        options.emFactory,
        options.eventBus,
        options.auditLogService,
      );
      await registerInventoryAdminRoutes(app, {
        emFactory: options.emFactory,
        ...(options.auditLogService ? { auditLogService: options.auditLogService } : {}),
        warehouseService,
        stockLevelService,
        warehouseChannelService,
        thresholdAdminService,
        lowStockAlertService,
        availabilityNotificationService: availabilityService,
        csvStockImporter,
        requireAdmin: options.requireAdmin,
        ...(options.resolveAdminAuditContext
          ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
          : {}),
      });
    }
  };

  return { plugin, handle: { availabilityWorker, lowStockAlertService, thresholdSettingsMirror } };
}
