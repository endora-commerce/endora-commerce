import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { QUICK_ORDER_SETTING_CODES } from '../quick_order/manifest.js';
import { CartService } from '../carts/services/cart-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import { ShoppingListService } from './services/shopping-list-service.js';
import { QuickOrderImportPipeline } from '../quick_order/services/import-pipeline.js';
import { MikroOrmCatalogLookup } from '../quick_order/services/catalog-lookup.js';
import { QuickOrderBuildService } from '../quick_order/services/quick-order-build-service.js';
import { registerShoppingListRoutes } from './routes.js';
import { registerQuickOrderRoutes } from '../quick_order/routes.js';
import { registerQuickOrderAdminRoutes } from '../quick_order/routes.admin.js';
import { registerQuickOrderPreferenceRoutes } from '../quick_order/routes.preferences.js';
import { registerQuickOrderPreferenceAdminRoutes } from '../quick_order/routes.preferences.admin.js';
import { DefaultPreferenceService } from '../quick_order/services/default-preference-service.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { OrganizationRestrictionService } from '../organizations/services/organization-restriction-service.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/** Default import row cap when no settings service is wired (matches the
 *  `quick_order.import_max_rows` manifest default). */
const DEFAULT_IMPORT_MAX_ROWS = 2000;

/**
 * Composition root for the shopping_lists + quick_order modules.
 *
 * `rfqService` is injected (built by the quote_requests module) so both the
 * shopping-list "convert to RFQ" flow and the quick-order "build → quote
 * request" flow use the same one-call `createForCustomer` API, with
 * revisions, events, and notifications wired in (feature 008).
 */

export interface ShoppingListsModuleOptions {
  emFactory: () => EntityManager;
  rfqService: RfqService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /**
   * Feature 027 — exposes the ShoppingListService back to commerceModule so
   * its `/api/v1/cart/items/:itemId/save-to-shopping-list` endpoint can
   * push lines into a list (cross-module call through this public
   * service, not via direct entity access).
   */
  exposeShoppingListService?: (service: ShoppingListService) => void;
  /**
   * Feature 039 — settings service used to read the
   * `quick_order.import_max_rows` cap. Optional; falls back to the manifest
   * default when omitted (e.g. minimal test harnesses).
   */
  settingsService?: SettingsService;
  /** Sales-channel id used to resolve the import-cap setting. */
  settingsChannelId?: string;
  /**
   * Feature 039 — when supplied, the admin quick-order on-behalf routes
   * (`/api/v1/admin/quick-order/*`) are registered, guarded by `orders:write`.
   */
  requireAdmin?: RequireAdminFactory;
  /**
   * Feature 039 (US2) — when supplied, the default-preferences routes are
   * registered. `organizationRestriction` is used for the eligibility
   * re-check; omit it to treat all methods as org-allowed.
   */
  auditLog?: AuditLogService;
  organizationRestriction?: OrganizationRestrictionService;
  /** Resolves the acting admin user id for the admin preference routes. */
  resolveAdminContext?: (req: FastifyRequest) => { adminUserId: string };
}

export function shoppingListsModule(options: ShoppingListsModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const cartService = new CartService(options.emFactory);
    const shoppingListService = new ShoppingListService(
      options.emFactory,
      cartService,
      options.rfqService,
    );
    if (options.exposeShoppingListService) options.exposeShoppingListService(shoppingListService);

    const pipeline = new QuickOrderImportPipeline(new MikroOrmCatalogLookup(options.emFactory));
    const buildService = new QuickOrderBuildService(cartService, options.rfqService);

    const resolveImportMaxRows = async (): Promise<number> => {
      const { settingsService, settingsChannelId } = options;
      if (!settingsService) return DEFAULT_IMPORT_MAX_ROWS;
      try {
        return await settingsService.get(
          QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS,
          settingsChannelId ?? 'default',
          z.number().int().positive(),
        );
      } catch {
        return DEFAULT_IMPORT_MAX_ROWS;
      }
    };

    await registerShoppingListRoutes(app, {
      service: shoppingListService,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
    });
    await registerQuickOrderRoutes(app, {
      pipeline,
      buildService,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      resolveCustomerContext: options.resolveCustomerContext,
      resolveImportMaxRows,
    });
    if (options.requireAdmin) {
      await registerQuickOrderAdminRoutes(app, {
        pipeline,
        buildService,
        requireAdmin: options.requireAdmin,
        resolveImportMaxRows,
      });
    }

    if (options.auditLog) {
      const preferenceService = new DefaultPreferenceService(
        options.emFactory,
        options.auditLog,
        options.organizationRestriction,
      );
      await registerQuickOrderPreferenceRoutes(app, {
        service: preferenceService,
        emFactory: options.emFactory,
        requireCustomer: options.requireCustomer,
        resolveCustomerContext: options.resolveCustomerContext,
      });
      if (options.requireAdmin && options.resolveAdminContext) {
        await registerQuickOrderPreferenceAdminRoutes(app, {
          service: preferenceService,
          emFactory: options.emFactory,
          requireAdmin: options.requireAdmin,
          resolveAdminContext: options.resolveAdminContext,
        });
      }
    }
  };
}
