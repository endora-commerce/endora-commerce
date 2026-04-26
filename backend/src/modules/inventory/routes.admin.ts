import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { StockLevel } from './entities/stock-level.entity.js';
import { Product } from '../catalog/entities/product.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Inventory admin routes (T165). Read + set stock-level per
 * (productId, variantId?). The set endpoint accepts an absolute `onHand`
 * value (operators usually re-count; deltas come from order events).
 *
 * Reserved counters are intentionally not editable from the UI — they're
 * driven by order placement / cancellation. The set endpoint clamps
 * reserved to 0 when creating a fresh row.
 */
export interface InventoryAdminDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

const setStockLevelSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  onHand: z.number().int().nonnegative(),
});

export async function registerInventoryAdminRoutes(
  app: FastifyInstance,
  deps: InventoryAdminDeps,
): Promise<void> {
  const { emFactory, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/inventory',
    { preHandler: requireAdmin('orders:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const where: Record<string, unknown> = {};
      if (q['productId']) where['productId'] = q['productId'];
      const limit = Math.min(Math.max(Number.parseInt(q['limit'] ?? '200', 10), 1), 500);
      const em = emFactory();
      const rows = await em.find(StockLevel, where, {
        limit,
        orderBy: { updatedAt: 'desc' },
      });
      // Hydrate product SKU + name for the UI in one batch.
      const productIds = Array.from(new Set(rows.map((r) => r.productId)));
      const products = productIds.length
        ? await em.find(Product, { id: { $in: productIds } })
        : [];
      const productById = new Map(products.map((p) => [p.id, p]));
      return {
        data: rows.map((r) => {
          const p = productById.get(r.productId);
          return {
            id: r.id,
            productId: r.productId,
            variantId: r.variantId ?? null,
            onHand: r.onHand,
            reserved: r.reserved,
            available: r.onHand - r.reserved,
            productSku: p?.sku ?? null,
            productName: p?.name ?? null,
            updatedAt: r.updatedAt.toISOString(),
          };
        }),
      };
    },
  );

  app.put(
    '/api/v1/admin/inventory',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: setStockLevelSchema },
    },
    async (request) => {
      const body = setStockLevelSchema.parse(request.body);
      const em = emFactory();
      const variantId = body.variantId ?? null;
      let row = await em.findOne(StockLevel, {
        productId: body.productId,
        variantId,
      });
      if (row) {
        row.onHand = body.onHand;
      } else {
        row = em.create(StockLevel, {
          productId: body.productId,
          ...(variantId ? { variantId } : {}),
          onHand: body.onHand,
        });
      }
      await em.persistAndFlush(row);
      return {
        data: {
          id: row.id,
          productId: row.productId,
          variantId: row.variantId ?? null,
          onHand: row.onHand,
          reserved: row.reserved,
          available: row.onHand - row.reserved,
        },
      };
    },
  );
}
