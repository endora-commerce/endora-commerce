import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  availabilityNotificationRequestSchema,
  inventoryDisplayModeSchema,
  isProductVisibleTo,
  type CatalogCategoryReadPort,
  type CatalogProductReadPort,
  type CustomerAccountReadPort,
  type InventoryDisplayMode,
  type StorefrontProductStock,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AvailabilityNotificationService } from './services/availability-notification-service.js';
import type { WarehouseChannelService } from './services/warehouse-channel-service.js';
import type { StockLevelService } from './services/stock-level-service.js';
import type { SalesChannelResolverService } from '../../kernel/sales-channels/sales-channel-resolver.service.js';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import { productAudienceOf } from '../../http/product-audience.js';
import { StockLevel } from './entities/stock-level.entity.js';
import { resolveDisplayBand } from './services/display-band-resolver.js';
import { resolveThresholds } from './services/threshold-resolver.js';
import { InventoryThreshold } from './entities/inventory-threshold.entity.js';
import { INVENTORY_SETTING_CODES } from './manifest.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';

export interface InventoryRoutesDeps {
  emFactory: () => EntityManager;
  /** `catalogProductReadPort`, owned by `catalog` (feature 075, Phase C). */
  catalogProducts: CatalogProductReadPort;
  /** `catalogCategoryReadPort`, owned by `catalog` — the threshold chain. */
  catalogCategories: CatalogCategoryReadPort;
  /** `customerAccountReadPort`, owned by `customer_accounts` (feature 075). */
  customerAccounts: CustomerAccountReadPort;
  availabilityService: AvailabilityNotificationService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** Optional — present in production composition. Used to resolve the
   *  channel for the storefront-public stock readout. */
  channelResolver?: SalesChannelResolverService;
  warehouseChannelService?: WarehouseChannelService;
  stockLevelService?: StockLevelService;
  settingsService?: SettingsService;
  /**
   * Feature 026 US4 — Per-request resolver that returns the warehouse-id
   * allow-list for the caller's Organization, or `null` when no restriction
   * applies (anonymous request, no-org Customer, or org has no warehouses
   * explicitly assigned). When the returned list is non-empty, the
   * storefront stock-figure endpoint intersects its candidate warehouse
   * set with this list before summing on-hand.
   */
  resolveOrganizationWarehouseAllowList?: (req: FastifyRequest) => Promise<string[] | null>;
}

export async function registerInventoryRoutes(
  app: FastifyInstance,
  deps: InventoryRoutesDeps,
): Promise<void> {
  const {
    emFactory,
    catalogProducts,
    catalogCategories,
    customerAccounts,
    availabilityService,
    requireCustomer,
    resolveCustomerContext,
    channelResolver,
    warehouseChannelService,
    settingsService,
  } = deps;

  // ---------------------------------------------------------------------------
  // Notify-when-available (foundation 001 backward-compat)
  // ---------------------------------------------------------------------------

  // Foundation 001 path — customer-only, pre-fills email from the
  // customer account. Kept for backwards compatibility with any
  // existing storefront/admin callers.
  app.post<{ Params: { id: string } }>(
    '/api/v1/catalog/products/:id/notify-when-available',
    {
      preHandler: requireCustomer,
      schema: { body: availabilityNotificationRequestSchema.optional() },
    },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = availabilityNotificationRequestSchema.parse(request.body ?? {});
      const customerAccount = await customerAccounts.findById(ctx.customerAccountId);
      if (!customerAccount) {
        reply.status(403);
        return {
          error: { code: 'FORBIDDEN', message: 'Unknown customer account', requestId: request.id },
        };
      }
      const subscription = await availabilityService.subscribe({
        customerAccountId: ctx.customerAccountId,
        email: customerAccount.email,
        productId: request.params.id,
        variantId: body.variantId ?? null,
      });
      reply.status(202);
      return {
        data: {
          subscriptionId: subscription.id,
          requestedAt: subscription.requestedAt.toISOString(),
        },
      };
    },
  );

  // Feature 010 / US6 — public path that accepts both anonymous and
  // authenticated callers. Email is supplied by the body; the storefront
  // pre-fills it from the customer account on the client side when a
  // session exists. Threaded auth is intentionally optional so the
  // anonymous Notify-when-available flow does not require a sign-in.
  app.post(
    '/api/v1/storefront/inventory/notify-when-available',
    {
      schema: {
        body: z.object({
          productId: z.string().uuid(),
          email: z.string().email(),
          variantId: z.string().uuid().nullable().optional(),
        }),
      },
    },
    async (request, reply) => {
      const body = request.body as { productId: string; email: string; variantId?: string | null };
      // Best-effort customer-account binding: when the request happens
      // to carry a valid customer context, link the row so the admin
      // queue browser shows the customer id alongside the email.
      let customerAccountId: string | null = null;
      try {
        const ctx = resolveCustomerContext(request);
        customerAccountId = ctx.customerAccountId;
      } catch {
        customerAccountId = null;
      }
      const subscription = await availabilityService.subscribe({
        productId: body.productId,
        email: body.email,
        variantId: body.variantId ?? null,
        customerAccountId,
      });
      reply.status(202);
      return {
        data: {
          subscriptionId: subscription.id,
          requestedAt: subscription.requestedAt.toISOString(),
        },
      };
    },
  );

  // ---------------------------------------------------------------------------
  // Storefront-public display-mode (US5)
  // ---------------------------------------------------------------------------

  app.get('/api/v1/storefront/inventory/display-mode', async (request) => {
    const channelId = await resolveChannelId(request, channelResolver);
    const mode = await readDisplayMode(channelId, settingsService);
    return { data: { displayMode: mode } };
  });

  // ---------------------------------------------------------------------------
  // Storefront-public per-product stock (US3 + US5)
  // ---------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>(
    '/api/v1/storefront/inventory/stock/:id',
    async (request, reply) => {
      const productId = request.params.id;
      const em = emFactory();
      const product = await catalogProducts.findById(productId);
      // Issue #227 — this route is anonymous and answers "how many of this
      // product are there". Both halves of that are a disclosure about a
      // product an operator restricted: that it exists, and how it is selling.
      if (!product || !isProductVisibleTo(product, productAudienceOf(request))) {
        reply.status(404);
        return {
          error: {
            code: 'PRODUCT_NOT_FOUND',
            message: 'Product not found',
            requestId: request.id,
          },
        };
      }

      const channelId = await resolveChannelId(request, channelResolver);
      let candidateWarehouseIds = warehouseChannelService
        ? await warehouseChannelService.resolveCandidateWarehouseIds(channelId)
        : [];

      // Feature 026 US4 — intersect with the caller's Organization allow-
      // list when one is configured. Empty per-org assignment (or no
      // resolver wired) falls through to the platform defaults above.
      if (deps.resolveOrganizationWarehouseAllowList) {
        const allowList = await deps.resolveOrganizationWarehouseAllowList(request);
        if (allowList && allowList.length > 0) {
          const allowSet = new Set(allowList);
          if (candidateWarehouseIds.length === 0) {
            candidateWarehouseIds = [...allowSet];
          } else {
            candidateWarehouseIds = candidateWarehouseIds.filter((id) => allowSet.has(id));
          }
        }
      }

      let cumulativeOnHand = 0;
      if (candidateWarehouseIds.length > 0) {
        // `em.execute`, not `em.getKnex()`: a knex handle takes its own pooled
        // connection, so this sum would answer from outside any transaction a
        // caller holds open while the `em.find` fallback below answers from
        // inside it — one route, two views of `stock_levels` (issue #207).
        const placeholders = candidateWarehouseIds.map(() => '?').join(', ');
        const sumRows = (await em.execute(
          `select sum(on_hand) as on_hand
             from stock_levels
            where product_id = ? and warehouse_id in (${placeholders})`,
          [productId, ...candidateWarehouseIds],
        )) as Array<{ on_hand: string | null }>;
        cumulativeOnHand = Number(sumRows[0]?.on_hand ?? 0);
      } else {
        // Fallback when no channel binding is wired yet.
        const rows = await em.find(StockLevel, { productId });
        cumulativeOnHand = rows.reduce((s, r) => s + r.onHand, 0);
      }

      const displayMode = await readDisplayMode(channelId, settingsService);

      const globalThresholds = await loadGlobalThresholds(em);
      const productThresholds = await loadProductThresholdsRow(em, productId);
      // Asked of `catalog`, not joined out of its `product_categories` table:
      // the bridge row is the owner's and the port has answered for it since
      // D-87 (feature 075, the `inventory` shard). The `findByIds` on the next
      // line was already going to the owner for the threshold columns — this is
      // the first half of the same question arriving at the same place.
      const assignments = await catalogCategories.listAssignmentsForProducts([productId]);
      const categoryIds = assignments.map((a) => a.categoryId);
      const categories = await catalogCategories.findByIds(categoryIds);
      const categoryThresholds = categories.map((c) => ({
        high: c.inventoryThresholdHigh,
        medium: c.inventoryThresholdMedium,
        low: c.inventoryThresholdLow,
      }));

      const thresholds = resolveThresholds({
        productThresholds,
        categoryThresholds,
        globalThresholds,
      });

      const displayBand = resolveDisplayBand({
        manageStock: product.manageStock,
        cumulativeOnHand,
        thresholds,
      });

      // Effective backorder = per-product flag AND the global negative-stock
      // gate; this is what order placement enforces, so the storefront must
      // not advertise backorder when the global gate is off.
      const allowNegativeStock = await readAllowNegativeStock(channelId, settingsService);
      const effectiveBackorderEnabled = product.backorderEnabled && allowNegativeStock;

      const isOutOfStock = product.manageStock && cumulativeOnHand <= 0;
      const showNotifyButton =
        product.manageStock &&
        !effectiveBackorderEnabled &&
        cumulativeOnHand <= 0;

      const payload: StorefrontProductStock = {
        productId,
        manageStock: product.manageStock,
        backorderEnabled: effectiveBackorderEnabled,
        displayMode,
        displayBand,
        exactOnHand: displayMode === 'exact' ? cumulativeOnHand : null,
        isOutOfStock,
        showNotifyButton,
      };
      return { data: payload };
    },
  );
}

async function resolveChannelId(
  request: FastifyRequest,
  _resolver?: SalesChannelResolverService,
): Promise<string> {
  // The canonical sales-channel resolver middleware already performed
  // header/host/system-default resolution and active-channel validation on
  // this request path, so simply read the resolved channel's id.
  return getResolvedChannel(request).id;
}

async function readDisplayMode(
  channelId: string,
  settingsService?: SettingsService,
): Promise<InventoryDisplayMode> {
  if (settingsService && channelId) {
    try {
      const value = await settingsService.get(
        INVENTORY_SETTING_CODES.DISPLAY_MODE,
        channelId,
        inventoryDisplayModeSchema,
      );
      return value;
    } catch {
      // fall through
    }
  }
  return 'band';
}

/**
 * Global backorder gate (`inventory.allow_negative_stock`) for a channel.
 * Mirrors `readDisplayMode`: per-channel value → global value → manifest
 * default (false). Failures degrade to false so the storefront never
 * promises a backorder the order placement would reject.
 */
async function readAllowNegativeStock(
  channelId: string,
  settingsService?: SettingsService,
): Promise<boolean> {
  if (settingsService && channelId) {
    try {
      const { z } = await import('zod');
      return await settingsService.get(
        INVENTORY_SETTING_CODES.ALLOW_NEGATIVE_STOCK,
        channelId,
        z.boolean(),
      );
    } catch {
      // fall through
    }
  }
  return false;
}

async function loadGlobalThresholds(em: EntityManager): Promise<{
  high: number | null;
  medium: number | null;
  low: number | null;
}> {
  const row = await em.findOne(InventoryThreshold, { scopeKind: 'global', scopeId: null });
  return {
    high: row?.thresholdHigh ?? 100,
    medium: row?.thresholdMedium ?? 20,
    low: row?.thresholdLow ?? 1,
  };
}

async function loadProductThresholdsRow(
  em: EntityManager,
  productId: string,
): Promise<{ high: number | null; medium: number | null; low: number | null } | null> {
  const row = await em.findOne(InventoryThreshold, { scopeKind: 'product', scopeId: productId });
  if (!row) return null;
  return {
    high: row.thresholdHigh ?? null,
    medium: row.thresholdMedium ?? null,
    low: row.thresholdLow ?? null,
  };
}
