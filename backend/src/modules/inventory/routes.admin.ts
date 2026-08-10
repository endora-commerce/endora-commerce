import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  assignWarehouseToChannelRequestSchema,
  createWarehouseRequestSchema,
  patchInventoryThresholdsRequestSchema,
  patchWarehouseChannelAssignmentRequestSchema,
  setProductWarehouseLowStockThresholdsRequestSchema,
  setStockLevelRequestSchema,
  updateWarehouseRequestSchema,
} from '@b2b/contracts';
import { StockLevel } from './entities/stock-level.entity.js';
import { Product } from '../catalog/entities/product.entity.js';
import { DEFAULT_WAREHOUSE_ID } from './entities/warehouse.entity.js';
import type { WarehouseService } from './services/warehouse-service.js';
import type { StockLevelService } from './services/stock-level-service.js';
import type { WarehouseChannelService } from './services/warehouse-channel-service.js';
import type { ThresholdAdminService } from './services/threshold-admin-service.js';
import type { LowStockAlertService } from './services/low-stock-alert-service.js';
import type { AvailabilityNotificationService } from './services/availability-notification-service.js';
import type { CsvStockImporter } from './services/csv-stock-importer.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

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
  warehouseChannelService: WarehouseChannelService;
  thresholdAdminService: ThresholdAdminService;
  lowStockAlertService: LowStockAlertService;
  availabilityNotificationService: AvailabilityNotificationService;
  csvStockImporter: CsvStockImporter;
  requireAdmin: RequireAdminFactory;
  /** Feature 024 — resolves admin actor identity for audit entries. */
  resolveAdminAuditContext?: (req: FastifyRequest) => {
    actorAdminUserId: string;
    impersonatedCustomerAccountId?: string | null;
  };
}

/** Build the per-request audit context for inventory route handlers. */
function buildAuditCtx(
  request: FastifyRequest,
  resolver:
    | ((req: FastifyRequest) => { actorAdminUserId: string; impersonatedCustomerAccountId?: string | null })
    | undefined,
) {
  const base = resolver?.(request);
  if (!base) return undefined;
  return {
    actorAdminUserId: base.actorAdminUserId,
    impersonatedCustomerAccountId: base.impersonatedCustomerAccountId ?? null,
    ipAddress: request.ip ?? null,
    userAgent:
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : null,
    requestId: request.id,
  };
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
  const {
    emFactory,
    warehouseService,
    stockLevelService,
    warehouseChannelService,
    thresholdAdminService,
    lowStockAlertService,
    availabilityNotificationService,
    csvStockImporter,
    requireAdmin,
  } = deps;

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
      const search = q['q']?.trim();
      const lowOnly = q['low'] === '1' || q['low'] === 'true';
      const outOnly = q['out'] === '1' || q['out'] === 'true';
      const data = await stockLevelService.listRoster({
        ...(q['productId'] ? { productId: q['productId'] } : {}),
        ...(q['warehouseId'] ? { warehouseId: q['warehouseId'] } : {}),
        ...(q['page'] ? { page: Number.parseInt(q['page'], 10) } : {}),
        ...(q['pageSize'] ? { pageSize: Number.parseInt(q['pageSize'], 10) } : {}),
        ...(search ? { q: search } : {}),
        ...(lowOnly ? { lowOnly: true } : {}),
        ...(outOnly ? { outOnly: true } : {}),
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
      const data = await stockLevelService.setOnHand(
        {
          productId: body.productId,
          warehouseId: body.warehouseId,
          ...(body.variantId ? { variantId: body.variantId } : {}),
          onHand: body.onHand,
        },
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data };
    },
  );

  // Per-(product, warehouse) low-stock thresholds. Consulted only when the
  // product runs in `lowStockThresholdMode = 'per_warehouse'`, but writeable
  // regardless of mode so admins can pre-populate values before switching.
  app.put(
    '/api/v1/admin/inventory/warehouse-low-stock-thresholds',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: setProductWarehouseLowStockThresholdsRequestSchema },
    },
    async (request, reply) => {
      const body = setProductWarehouseLowStockThresholdsRequestSchema.parse(
        request.body,
      );
      await stockLevelService.setProductWarehouseThresholds({
        productId: body.productId,
        entries: body.thresholds,
      });
      return reply.status(204).send();
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
      const data = await warehouseService.create(
        {
          name: body.name,
          code: body.code,
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.description !== undefined ? { description: body.description ?? null } : {}),
          ...(body.address !== undefined ? { address: body.address ?? null } : {}),
          ...(body.contact !== undefined ? { contact: body.contact ?? null } : {}),
          ...(body.defaultLowStockThreshold !== undefined
            ? { defaultLowStockThreshold: body.defaultLowStockThreshold ?? null }
            : {}),
        },
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
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
      const data = await warehouseService.update(
        id,
        {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.description !== undefined ? { description: body.description ?? null } : {}),
          ...(body.address !== undefined ? { address: body.address ?? null } : {}),
          ...(body.contact !== undefined ? { contact: body.contact ?? null } : {}),
          ...(body.defaultLowStockThreshold !== undefined
            ? { defaultLowStockThreshold: body.defaultLowStockThreshold ?? null }
            : {}),
        },
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data };
    },
  );

  app.delete(
    '/api/v1/admin/warehouses/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await warehouseService.delete(id, buildAuditCtx(request, deps.resolveAdminAuditContext));
      reply.status(204);
    },
  );

  // ---------------------------------------------------------------------------
  // Low-stock alerts (US4)
  // ---------------------------------------------------------------------------

  app.get(
    '/api/v1/admin/inventory/low-stock',
    { preHandler: requireAdmin('orders:read') },
    async () => {
      const items = await lowStockAlertService.listLowStock();
      return { items };
    },
  );

  // ---------------------------------------------------------------------------
  // Display-band thresholds (US5)
  // ---------------------------------------------------------------------------

  app.get(
    '/api/v1/admin/inventory/thresholds',
    { preHandler: requireAdmin('orders:read') },
    async () => {
      const data = await thresholdAdminService.read();
      return { data };
    },
  );

  app.patch(
    '/api/v1/admin/inventory/thresholds',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: patchInventoryThresholdsRequestSchema },
    },
    async (request) => {
      const body = patchInventoryThresholdsRequestSchema.parse(request.body);
      const data = await thresholdAdminService.patch(
        {
          ...(body.global ? { global: body.global } : {}),
          ...(body.perCategory ? { perCategory: body.perCategory } : {}),
          ...(body.perProduct ? { perProduct: body.perProduct } : {}),
        },
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data };
    },
  );

  // ---------------------------------------------------------------------------
  // CSV stock import (US7)
  // ---------------------------------------------------------------------------

  app.post(
    '/api/v1/admin/inventory/import',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const body = (request.body ?? {}) as { csv?: string; warehouseId?: string };
      if (!body.csv || !body.warehouseId) {
        reply.status(400);
        return {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'csv + warehouseId are required',
            requestId: request.id,
          },
        };
      }
      const result = await csvStockImporter.run(
        {
          csv: body.csv,
          warehouseId: body.warehouseId,
          dryRun: q['dryRun'] === 'true',
          ...(q['fileName'] !== undefined ? { fileName: q['fileName'] } : {}),
        },
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: result };
    },
  );

  // ---------------------------------------------------------------------------
  // Availability notifications (US6)
  // ---------------------------------------------------------------------------

  app.get(
    '/api/v1/admin/inventory/availability-notifications',
    { preHandler: requireAdmin('orders:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const data = await availabilityNotificationService.listForAdmin({
        ...(q['productId'] ? { productId: q['productId'] } : {}),
        ...(q['status'] ? { status: q['status'] as 'queued' | 'notified' | 'cancelled' } : {}),
        ...(q['page'] ? { page: Number.parseInt(q['page'], 10) } : {}),
        ...(q['pageSize'] ? { pageSize: Number.parseInt(q['pageSize'], 10) } : {}),
      });
      return data;
    },
  );

  app.patch(
    '/api/v1/admin/inventory/availability-notifications/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { status?: string };
      if (body.status !== 'cancelled') {
        reply.status(400);
        return {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Only `status: "cancelled"` is supported on this endpoint',
            requestId: request.id,
          },
        };
      }
      await availabilityNotificationService.cancel(id);
      reply.status(204);
      return null;
    },
  );

  // ---------------------------------------------------------------------------
  // Sales channel ↔ warehouse binding (US3)
  // ---------------------------------------------------------------------------

  app.get(
    '/api/v1/admin/sales-channels/:channelId/warehouses',
    { preHandler: requireAdmin('orders:read') },
    async (request) => {
      const { channelId } = request.params as { channelId: string };
      const items = await warehouseChannelService.listForChannel(channelId);
      return { items };
    },
  );

  app.post(
    '/api/v1/admin/sales-channels/:channelId/warehouses',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: assignWarehouseToChannelRequestSchema },
    },
    async (request, reply) => {
      const { channelId } = request.params as { channelId: string };
      const body = assignWarehouseToChannelRequestSchema.parse(request.body);
      const data = await warehouseChannelService.assign(channelId, {
        warehouseId: body.warehouseId,
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      });
      reply.status(201);
      return { data };
    },
  );

  app.patch(
    '/api/v1/admin/sales-channels/:channelId/warehouses/:assignmentId',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: patchWarehouseChannelAssignmentRequestSchema },
    },
    async (request) => {
      const { channelId, assignmentId } = request.params as {
        channelId: string;
        assignmentId: string;
      };
      const body = patchWarehouseChannelAssignmentRequestSchema.parse(request.body);
      const data = await warehouseChannelService.patch(channelId, assignmentId, {
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      });
      return { data };
    },
  );

  app.delete(
    '/api/v1/admin/sales-channels/:channelId/warehouses/:assignmentId',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const { channelId, assignmentId } = request.params as {
        channelId: string;
        assignmentId: string;
      };
      await warehouseChannelService.unassign(channelId, assignmentId);
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
