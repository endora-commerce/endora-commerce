import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  availabilityNotificationRequestSchema,
  inventoryDisplayModeSchema,
  type InventoryDisplayMode,
  type StorefrontProductStock,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AvailabilityNotificationService } from './services/availability-notification-service.js';
import type { WarehouseChannelService } from './services/warehouse-channel-service.js';
import type { StockLevelService } from './services/stock-level-service.js';
import type { SalesChannelResolverService } from '../sales_channels/services/sales-channel-resolver.service.js';
import { CustomerAccount } from '../customer_accounts/entities/customer-account.entity.js';
import { Product } from '../catalog/entities/product.entity.js';
import { StockLevel } from './entities/stock-level.entity.js';
import { resolveDisplayBand } from './services/display-band-resolver.js';
import { resolveThresholds } from './services/threshold-resolver.js';
import { InventoryThreshold } from './entities/inventory-threshold.entity.js';
import { Category } from '../catalog/entities/category.entity.js';
import { INVENTORY_SETTING_CODES } from './manifest.js';
import { SettingsService } from '../settings/services/settings.service.js';

export interface InventoryRoutesDeps {
  emFactory: () => EntityManager;
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
}

export async function registerInventoryRoutes(
  app: FastifyInstance,
  deps: InventoryRoutesDeps,
): Promise<void> {
  const {
    emFactory,
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

  app.post<{ Params: { id: string } }>(
    '/api/v1/catalog/products/:id/notify-when-available',
    {
      preHandler: requireCustomer,
      schema: { body: availabilityNotificationRequestSchema.optional() },
    },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = availabilityNotificationRequestSchema.parse(request.body ?? {});
      const em = emFactory();
      const customerAccount = await em.findOne(CustomerAccount, { id: ctx.customerAccountId });
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
      const product = await em.findOne(Product, { id: productId });
      if (!product) {
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
      const candidateWarehouseIds = warehouseChannelService
        ? await warehouseChannelService.resolveCandidateWarehouseIds(channelId)
        : [];

      let cumulativeOnHand = 0;
      if (candidateWarehouseIds.length > 0) {
        const knex = em.getKnex();
        const sumRow = await knex('stock_levels')
          .where('product_id', productId)
          .whereIn('warehouse_id', candidateWarehouseIds)
          .sum<{ on_hand: string | null }[]>('on_hand as on_hand')
          .first();
        cumulativeOnHand = Number(sumRow?.on_hand ?? 0);
      } else {
        // Fallback when no channel binding is wired yet.
        const rows = await em.find(StockLevel, { productId });
        cumulativeOnHand = rows.reduce((s, r) => s + r.onHand, 0);
      }

      const displayMode = await readDisplayMode(channelId, settingsService);

      const globalThresholds = await loadGlobalThresholds(em);
      const productThresholds = await loadProductThresholdsRow(em, productId);
      const knex = em.getKnex();
      const productCategoryRows = await knex('product_categories')
        .where('product_id', productId)
        .select<Array<{ category_id: string }>>('category_id');
      const categoryIds = productCategoryRows.map((r) => r.category_id);
      const categories = categoryIds.length
        ? await em.find(Category, { id: { $in: categoryIds } })
        : [];
      const categoryThresholds = categories.map((c) => ({
        high: c.inventoryThresholdHigh ?? null,
        medium: c.inventoryThresholdMedium ?? null,
        low: c.inventoryThresholdLow ?? null,
      }));

      const thresholds = resolveThresholds({
        productThresholds,
        categoryThresholds,
        globalThresholds,
      });

      const displayBand = resolveDisplayBand({
        manageStock: product.manageStock ?? true,
        cumulativeOnHand,
        thresholds,
      });

      const isOutOfStock = (product.manageStock ?? true) && cumulativeOnHand <= 0;
      const showNotifyButton =
        (product.manageStock ?? true) &&
        !(product.backorderEnabled ?? false) &&
        cumulativeOnHand <= 0;

      const payload: StorefrontProductStock = {
        productId,
        manageStock: product.manageStock ?? true,
        backorderEnabled: product.backorderEnabled ?? false,
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
  resolver?: SalesChannelResolverService,
): Promise<string> {
  if (resolver) {
    const headerHandle =
      typeof (request.headers as Record<string, unknown>)['x-sales-channel'] === 'string'
        ? ((request.headers as Record<string, string>)['x-sales-channel'] ?? null)
        : null;
    if (headerHandle) {
      const resolved = await resolver.resolveActive(headerHandle);
      if (resolved.ok) return resolved.channel.id;
    }
    const fallback = await resolver.getSystemDefault();
    if (fallback) return fallback.id;
  }
  // Without a resolver the storefront caller must supply ?channelId=…
  const q = (request.query ?? {}) as Record<string, string | undefined>;
  return q['channelId'] ?? '';
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
