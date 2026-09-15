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
  type CatalogProductReadPort,
} from '@endora-commerce/contracts';
import { StockLevel } from './entities/stock-level.entity.js';
import { DEFAULT_WAREHOUSE_ID } from './entities/warehouse.entity.js';
import type { WarehouseService } from './services/warehouse-service.js';
import type { StockLevelService } from './services/stock-level-service.js';
import type { WarehouseChannelService } from './services/warehouse-channel-service.js';
import type { ThresholdAdminService } from './services/threshold-admin-service.js';
import type { LowStockAlertService } from './services/low-stock-alert-service.js';
import type { AvailabilityNotificationService } from './services/availability-notification-service.js';
import type { CsvStockImporter } from './services/csv-stock-importer.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Inventory admin routes — feature 010 (US1 + US2).
 *
 * **Every gate below is this module's own** (2026-08-29). All 21 used to
 * enforce a code somebody else owns: nine reads on `orders:read` and twelve
 * writes on `catalog:write`. Neither names the data touched, which is the
 * discriminator `specs/080-f4-real-scope/payments-permission-ownership.md` §7.2
 * sets and `specs/080-f4-real-scope/first-deployment-window.md` §2 applies per route rather than
 * per module. A warehouse is a physical location with an address, not catalogue
 * data; a channel↔warehouse assignment is fulfilment routing, deciding which
 * stock a channel may sell; a stock level, a display-band threshold, a CSV
 * import and a back-in-stock queue entry are all rows in this module's own
 * tables. Nothing here reads or writes a product, a price or an order.
 *
 * The read side was the mirror of the same defect and is worth stating on its
 * own: a merchandiser holding `catalog:read` could not see stock at all, while
 * anyone holding `orders:read` could enumerate every warehouse and its address.
 *
 * `inventory:read` / `inventory:write`, and no third code. The one route that
 * genuinely joins another module's table — the roster's `products` join in
 * `StockLevelService` — is a *reach* and is ledgered as one; it is not an
 * authority question, and it is refused to a catalogue editor exactly as the
 * rest of this file now is.
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
  /** `catalogProductReadPort`, owned by `catalog` (feature 075, Phase C). */
  catalogProducts: CatalogProductReadPort;
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
    catalogProducts,
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
    { preHandler: requireAdmin('inventory:read') },
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
    { preHandler: requireAdmin('inventory:read') },
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
      preHandler: requireAdmin('inventory:write'),
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
      preHandler: requireAdmin('inventory:write'),
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
    { preHandler: requireAdmin('inventory:read') },
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
    { preHandler: requireAdmin('inventory:read') },
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
      preHandler: requireAdmin('inventory:write'),
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
      preHandler: requireAdmin('inventory:write'),
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
    { preHandler: requireAdmin('inventory:write') },
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
    { preHandler: requireAdmin('inventory:read') },
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
    { preHandler: requireAdmin('inventory:read') },
    async () => {
      const data = await thresholdAdminService.read();
      return { data };
    },
  );

  app.patch(
    '/api/v1/admin/inventory/thresholds',
    {
      preHandler: requireAdmin('inventory:write'),
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
    { preHandler: requireAdmin('inventory:write') },
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
    { preHandler: requireAdmin('inventory:read') },
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
    { preHandler: requireAdmin('inventory:write') },
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
    { preHandler: requireAdmin('inventory:read') },
    async (request) => {
      const { channelId } = request.params as { channelId: string };
      const items = await warehouseChannelService.listForChannel(channelId);
      return { items };
    },
  );

  app.post(
    '/api/v1/admin/sales-channels/:channelId/warehouses',
    {
      preHandler: requireAdmin('inventory:write'),
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
      preHandler: requireAdmin('inventory:write'),
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
    { preHandler: requireAdmin('inventory:write') },
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
  // Both routes default to the seeded Default warehouse.
  //
  // The two callers this header used to name are gone: the admin import posts to
  // `/inventory/import` and the catalog seed writes `StockLevel` through the
  // EntityManager. Nothing in the repository calls either route — no admin
  // screen, no admin API client call, no seed, no script — and the module's
  // documentation page lists neither. They are kept for a deployment's own
  // integration, which is the only caller they can still have (issue #125).
  //
  // Issue #139 (D-66) ruled the `GET .../legacy` below deletable on the
  // condition that `GET .../levels` is a strict superset of it, "and if
  // `/levels` turns out not to cover a field this returns, that gap is the
  // finding and the deletion waits". It does not: `/levels` aggregates per
  // product across variants and warehouses, so it answers with neither
  // `variantId` nor the row's `updatedAt` (nor the `stock_levels` row id, nor
  // the pre-computed `available`, both derivable). The deletion therefore
  // waits on a per-row read that covers those two fields, not on a caller
  // census — that census is done, and it is zero.
  // ---------------------------------------------------------------------------

  /**
   * @deprecated Use `PUT /api/v1/admin/inventory/levels`, which takes an
   * explicit `warehouseId` instead of writing into the seeded Default one.
   * Kept for a deployment's own integration until the access log or the
   * deployment owner confirms nothing calls it (issue #139, D-66 part 3).
   *
   * Delegates to `StockLevelService.setOnHand`, the single point that emits
   * `inventory.adjusted.v1` (issue #139). Until then this handler wrote
   * `StockLevel.onHand` straight through the EntityManager, so a restock
   * performed here fired no back-in-stock fan-out (US6) and no low-stock
   * crossing alert (US4), and validated neither the product nor the warehouse
   * — a typo'd product id created a stock row for a product that does not
   * exist. The delegation is the whole of that repair; the response shape and
   * the `catalog:write` gate are unchanged.
   *
   * The audited path for a stock change is `StockLevelService`
   * (`stock_level.adjust`); this endpoint recorded nothing until issue #122,
   * which the coverage scan could not see until it reached route files. The
   * delegate records the same action token, so the two paths still land in one
   * audit history.
   *
   * Deliberately **not** a Command (issue #125). A Command is what an undo
   * attaches to, and an on-hand count is not a value an undo may restore:
   * between the write and the undo, orders reserve and release stock, so
   * putting back the number that stood before would overwrite movements
   * nobody asked to reverse. The other two paths that set stock — the service
   * behind `/levels` and the CSV importer — take the same view. Nor may this
   * row's action diverge from theirs: an auditor reading a product's stock
   * history reads one action, not three.
   */
  app.put(
    '/api/v1/admin/inventory',
    {
      preHandler: requireAdmin('inventory:write'),
      schema: { body: setLegacyStockLevelSchema },
    },
    async (request) => {
      const body = setLegacyStockLevelSchema.parse(request.body);
      const variantId = body.variantId ?? null;

      await stockLevelService.setOnHand(
        {
          productId: body.productId,
          warehouseId: DEFAULT_WAREHOUSE_ID,
          variantId,
          onHand: body.onHand,
        },
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );

      // Re-read for the foundation-001 response shape: `setOnHand` answers with
      // the before/after counts, this route has always answered with the row.
      const row = await emFactory().findOneOrFail(StockLevel, {
        productId: body.productId,
        variantId,
        warehouseId: DEFAULT_WAREHOUSE_ID,
      });
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
    { preHandler: requireAdmin('inventory:read') },
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
      const products = await catalogProducts.findByIds(productIds);
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
