import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  createWarehouseRequestSchema,
  setStockLevelRequestSchema,
  updateWarehouseRequestSchema,
} from '@b2b/contracts';
import { StockLevel } from './entities/stock-level.entity.js';
import { Product } from '../catalog/entities/product.entity.js';
import { DEFAULT_WAREHOUSE_ID } from './entities/warehouse.entity.js';
import { WarehouseService } from './services/warehouse-service.js';
import { StockLevelService } from './services/stock-level-service.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Inventory admin routes — feature 010 (US1 + US2).
 *
 * Surfaces:
 *   - Legacy single-bucket stock-level read/write (foundation 001 backward
 *     compat — kept until callers migrate to the per-warehouse PUT below).
 *   - Warehouse CRUD (US1).
 *   - Inventory landing KPIs + per-product roster + per-warehouse setOnHand
 *     (US2).
 */
export interface InventoryAdminDeps {
  emFactory: () => EntityManager;
  warehouseService: WarehouseService;
  stockLevelService: StockLevelService;
  requireAdmin: RequireAdminFactory;
}

const setLegacyStockLevelSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  onHand: z.number().int().nonnegative(),
});

export async function registerInventoryAdminRoutes(
  app: FastifyInstance,
  deps: InventoryAdminDeps,
): Promise<void> {
  const { emFactory, warehouseService, stockLevelService, requireAdmin } = deps;

  // ---------------------------------------------------------------------------
  // Inventory landing KPIs (US2)
  // ---------------------------------------------------------------------------

  app.get(
    '/api/v1/admin/inventory',
    { preHandler: requireAdmin('orders:read') },
    async () => {
      const data = await stockLevelService.listLandingKpis();
      return { data };
    },
  );

  // ---------------------------------------------------------------------------
  // Per-product roster + per-warehouse setOnHand (US2)
  // ---------------------------------------------------------------------------

  app.get(
    '/api/v1/admin/inventory/levels',
    { preHandler: requireAdmin('orders:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const data = await stockLevelService.listRoster({
        ...(q['productId'] ? { productId: q['productId'] } : {}),
        ...(q['warehouseId'] ? { warehouseId: q['warehouseId'] } : {}),
        ...(q['page'] ? { page: Number.parseInt(q['page'], 10) } : {}),
        ...(q['pageSize'] ? { pageSize: Number.parseInt(q['pageSize'], 10) } : {}),
      });
      return data;
    },
  );

  app.put(
    '/api/v1/admin/inventory/levels',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: setStockLevelRequestSchema },
    },
    async (request) => {
      const body = setStockLevelRequestSchema.parse(request.body);
      const data = await stockLevelService.setOnHand({
        productId: body.productId,
        warehouseId: body.warehouseId,
        ...(body.variantId ? { variantId: body.variantId } : {}),
        onHand: body.onHand,
      });
      return { data };
    },
  );

  // ---------------------------------------------------------------------------
  // Warehouse CRUD (US1)
  // ---------------------------------------------------------------------------

  app.get(
    '/api/v1/admin/warehouses',
    { preHandler: requireAdmin('orders:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const data = await warehouseService.list({
        ...(q['page'] ? { page: Number.parseInt(q['page'], 10) } : {}),
        ...(q['pageSize'] ? { pageSize: Number.parseInt(q['pageSize'], 10) } : {}),
        activeOnly: q['activeOnly'] === 'true',
        withTotals: q['withTotals'] !== 'false',
      });
      return data;
    },
  );

  app.get(
    '/api/v1/admin/warehouses/:id',
    { preHandler: requireAdmin('orders:read') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const data = await warehouseService.getById(id, { withTotals: true });
      if (!data) {
        reply.status(404);
        return {
          error: {
            code: 'WAREHOUSE_NOT_FOUND',
            message: 'Warehouse not found',
            requestId: request.id,
          },
        };
      }
      return { data };
    },
  );

  app.post(
    '/api/v1/admin/warehouses',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: createWarehouseRequestSchema },
    },
    async (request, reply) => {
      const body = createWarehouseRequestSchema.parse(request.body);
      const data = await warehouseService.create({
        name: body.name,
        code: body.code,
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(body.address !== undefined ? { address: body.address ?? null } : {}),
        ...(body.contact !== undefined ? { contact: body.contact ?? null } : {}),
      });
      reply.status(201);
      return { data };
    },
  );

  app.patch(
    '/api/v1/admin/warehouses/:id',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: updateWarehouseRequestSchema },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = updateWarehouseRequestSchema.parse(request.body);
      const data = await warehouseService.update(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.description !== undefined ? { description: body.description ?? null } : {}),
        ...(body.address !== undefined ? { address: body.address ?? null } : {}),
        ...(body.contact !== undefined ? { contact: body.contact ?? null } : {}),
      });
      return { data };
    },
  );

  app.delete(
    '/api/v1/admin/warehouses/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await warehouseService.delete(id);
      reply.status(204);
    },
  );

  // ---------------------------------------------------------------------------
  // Foundation 001 backward-compat — single-bucket stock list + write.
  // Foundation callers (admin import + foundation seed) still hit these
  // until they migrate to /levels above. Both routes default to the seeded
  // Default warehouse.
  // ---------------------------------------------------------------------------

  app.put(
    '/api/v1/admin/inventory',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: setLegacyStockLevelSchema },
    },
    async (request) => {
      const body = setLegacyStockLevelSchema.parse(request.body);
      const em = emFactory();
      const variantId = body.variantId ?? null;
      let row = await em.findOne(StockLevel, {
        productId: body.productId,
        variantId,
        warehouseId: DEFAULT_WAREHOUSE_ID,
      });
      if (row) {
        row.onHand = body.onHand;
      } else {
        row = em.create(StockLevel, {
          productId: body.productId,
          ...(variantId ? { variantId } : {}),
          warehouseId: DEFAULT_WAREHOUSE_ID,
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

  app.get(
    '/api/v1/admin/inventory/legacy',
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
            warehouseId: r.warehouseId,
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
}
