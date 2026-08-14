import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import type { CartService } from '../carts/services/cart-service.js';
import type { CatalogAttributeReadService } from '../catalog/services/catalog-attribute-read.service.js';
import type { OrderService } from '../orders/services/order-service.js';
import type { OrganizationRestrictionService } from '../organizations/services/organization-restriction-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';
import { QUICK_ORDER_SETTING_CODES } from './manifest.js';
import { MikroOrmCatalogLookup } from './services/catalog-lookup.js';
import { QuickOrderImportPipeline } from './services/import-pipeline.js';
import { QuickOrderBuildService } from './services/quick-order-build-service.js';
import { DefaultPreferenceService } from './services/default-preference-service.js';
import { OneClickService } from './services/one-click-service.js';
import { registerQuickOrderRoutes } from './routes.js';
import { registerQuickOrderAdminRoutes } from './routes.admin.js';
import { registerQuickOrderPreferenceRoutes } from './routes.preferences.js';
import { registerQuickOrderPreferenceAdminRoutes } from './routes.preferences.admin.js';
import { registerQuickOrderOneClickRoutes } from './routes.one-click.js';

/**
 * `quick_order` — a module that owned five route files and was mounted by
 * another module's plugin (feature 072, wave 4, T139).
 *
 * Nothing here is new code. All of it lived in `shopping_lists/plugin.ts`,
 * whose header described itself as *"composition root for the shopping_lists +
 * quick_order modules"* — two lifecycle participants, one factory, and
 * therefore one activation control. `shopping_lists`' own manifest said so
 * outright: its description covered "the quick-order surfaces this module
 * hosts", with a note pointing at this task.
 *
 * The cost was not organisational. Because the surfaces were mounted by
 * `shopping_lists`, switching *that* module off took quick order with it, and
 * switching quick order off was not expressible at all — a deployment that
 * wants CSV import but no shopping lists, or the reverse, could not be
 * configured. Constitution XVII says presence is per module; a module whose
 * surfaces another module mounts has no presence of its own.
 *
 * **Three nested conditionals decided which endpoints existed.** The host
 * mounted the preference routes only `if (options.auditLog)`, the admin
 * preference routes only `if (options.requireAdmin && options.resolveAdminContext)`,
 * and one-click buy only `if (options.getOrderService && options.resolveOneClickEnabled)`.
 * Every root passed all five, so the reduced shapes were nobody's deployment —
 * but "which endpoints does this module serve" answered by "which arguments did
 * a root remember", which is the defect this whole wave removes. All five route
 * groups register unconditionally now, and the module's own activation control
 * is the one intentional gate.
 *
 * The one-click flow reaches `OrderService` through `orderServiceAccessor`,
 * which `orders` provides since T141. It was `oneClickOrderServiceGetter`, a
 * root closure over a root-held variable an `expose…` callback filled in.
 */

/** What `quick_order` resolves from the container, and the names it owns. */
export interface QuickOrderCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  readonly customerContextResolver: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  readonly settingsReadPort: SettingsService;
  readonly cartService: CartService;
  readonly rfqService: RfqService;
  readonly catalogAttributeReadPort: CatalogAttributeReadService;
  readonly organizationRestrictionPort: OrganizationRestrictionService;
  /**
   * `orders`' own accessor (T141). It was `oneClickOrderServiceGetter`, a root
   * closure over a root-held variable an `expose…` callback filled in; the
   * module holds that binding itself now. Still an accessor because the timing
   * is real — the service exists only once `orders` registers its routes.
   */
  readonly orderServiceAccessor: () => OrderService | null;
  readonly quickOrderPipeline: QuickOrderImportPipeline;
  readonly quickOrderBuildService: QuickOrderBuildService;
  readonly quickOrderPreferenceService: DefaultPreferenceService;
  readonly quickOrderOneClickService: OneClickService;
}

/**
 * Matches the `quick_order.import_max_rows` manifest default. Reached only when
 * the setting is unseeded or out of scope for the channel — not, as before,
 * when a composition omitted the settings service.
 */
const DEFAULT_IMPORT_MAX_ROWS = 2000;

export function registerModule(ctx: ModuleContext): void {
  const cradle = (): QuickOrderCradle => ctx.cradle<QuickOrderCradle>();

  ctx.di.register({
    quickOrderPipeline: ctx
      .asFunction(
        ({ emFactory }: QuickOrderCradle) =>
          new QuickOrderImportPipeline(new MikroOrmCatalogLookup(emFactory)),
      )
      .singleton(),

    quickOrderBuildService: ctx
      .asFunction(
        () =>
          new QuickOrderBuildService(
            // Both are other modules' gated ports and both are stored by the
            // constructor, so a singleton may not hold them directly — Awilix's
            // strict mode refuses a transient inside a longer-lived object.
            lazyPort<CartService>(ctx, 'cartService'),
            lazyPort<RfqService>(ctx, 'rfqService'),
          ),
      )
      .singleton(),

    quickOrderPreferenceService: ctx
      .asFunction(
        ({ emFactory, auditLogService }: QuickOrderCradle) =>
          new DefaultPreferenceService(
            emFactory,
            auditLogService,
            lazyPort<OrganizationRestrictionService>(ctx, 'organizationRestrictionPort'),
          ),
      )
      .singleton(),

    quickOrderOneClickService: ctx
      .asFunction(
        ({ quickOrderPreferenceService }: QuickOrderCradle) =>
          new OneClickService(
            quickOrderPreferenceService,
            lazyPort<CartService>(ctx, 'cartService'),
            () => cradle().orderServiceAccessor(),
            // This module's own setting, read here rather than through a
            // resolver a host passes down.
            async (salesChannelId: string) => {
              try {
                return await cradle().settingsReadPort.get(
                  QUICK_ORDER_SETTING_CODES.ONE_CLICK_BUY_ENABLED,
                  salesChannelId,
                  z.boolean(),
                );
              } catch {
                return false;
              }
            },
          ),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const {
      emFactory,
      requireAdmin,
      quickOrderPipeline: pipeline,
      quickOrderBuildService: buildService,
      quickOrderPreferenceService: preferenceService,
      quickOrderOneClickService: oneClickService,
    } = cradle();
    const requireCustomer = (req: FastifyRequest, reply: unknown): Promise<void> =>
      cradle().requireCustomer(req, reply);
    const resolveCustomerContext = (
      req: FastifyRequest,
    ): { customerAccountId: string; organizationId: string } =>
      cradle().customerContextResolver(req);

    /**
     * Read per request against the resolved channel. Before T139 the host read
     * it against a `settingsChannelId` option it defaulted to `'default'`, and
     * fell back to the constant whenever a composition passed no settings
     * service at all — which the harness did, so every test ran the manifest
     * default while production read the configured value (T133's finding, one
     * layer down).
     */
    const resolveImportMaxRows = async (): Promise<number> => {
      try {
        return await cradle().settingsReadPort.get(
          QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS,
          'default',
          z.number().int().positive(),
        );
      } catch {
        return DEFAULT_IMPORT_MAX_ROWS;
      }
    };

    await registerQuickOrderRoutes(app, {
      pipeline,
      buildService,
      emFactory,
      requireCustomer,
      resolveCustomerContext,
      resolveImportMaxRows,
      catalogAttributeRead: lazyPort<CatalogAttributeReadService>(
        ctx,
        'catalogAttributeReadPort',
      ),
    });

    await registerQuickOrderAdminRoutes(app, {
      pipeline,
      buildService,
      requireAdmin,
      resolveImportMaxRows,
    });

    await registerQuickOrderPreferenceRoutes(app, {
      service: preferenceService,
      emFactory,
      requireCustomer,
      resolveCustomerContext,
    });

    await registerQuickOrderPreferenceAdminRoutes(app, {
      service: preferenceService,
      emFactory,
      requireAdmin,
      resolveAdminContext: (req: FastifyRequest) => cradle().adminContextResolver(req),
    });

    await registerQuickOrderOneClickRoutes(app, {
      service: oneClickService,
      requireCustomer,
      resolveCustomerContext,
    });
  });
}
