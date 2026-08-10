import {
  SearchWarehousesParamsSchema,
  SetStockLevelParamsSchema,
  type SearchWarehousesParams,
  type SetStockLevelParams,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../http/error-envelope.js';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import { Product } from '../catalog/entities/product.entity.js';
import { StockLevel } from './entities/stock-level.entity.js';
import { Warehouse } from './entities/warehouse.entity.js';
import { StockLevelService } from './services/stock-level-service.js';
import { WarehouseService } from './services/warehouse-service.js';
import type {
  PromptActionTool,
  ToolContext,
} from '../prompt_actions/services/tool-registry.js';

/**
 * Inventory's contribution to the prompt-assistant tool catalogue
 * (feature 043, data-model §4): the warehouse resolver and the flagship
 * `set_stock_level` mutation. The mutation's preview is server-computed
 * from the same rows the execution will touch (FR-004), and execution
 * rides `StockLevelService.setOnHand` — the exact path of the manual
 * inventory screen, including its `stock_level.adjust` audit row.
 */

export interface InventoryPromptToolsDeps {
  emFactory: () => EntityManager;
  eventBus?: EventBus;
  auditLogService?: AuditLogService;
}

const RESULT_LIMIT = 20;

function label(name: Record<string, string>): string {
  return name['en'] ?? Object.values(name)[0] ?? '(unnamed)';
}

export function inventoryPromptTools(deps: InventoryPromptToolsDeps): PromptActionTool[] {
  const warehouseService = new WarehouseService(deps.emFactory);
  const stockLevelService = new StockLevelService(
    deps.emFactory,
    deps.eventBus,
    deps.auditLogService,
  );

  const searchWarehouses: PromptActionTool<SearchWarehousesParams> = {
    id: 'inventory.search_warehouses',
    moduleId: 'inventory',
    kind: 'resolver',
    description:
      'Search warehouses by a name or code fragment (case-insensitive). Returns up to 20 matches as {id, label, code, active}.',
    requiredPermission: 'catalog:read',
    paramsSchema: SearchWarehousesParamsSchema,
    execute: async (params) => {
      const { items } = await warehouseService.list({ pageSize: 200 });
      const needle = params.q.toLowerCase();
      return items
        .filter(
          (w) =>
            w.name.toLowerCase().includes(needle) || w.code.toLowerCase().includes(needle),
        )
        .slice(0, RESULT_LIMIT)
        .map((w) => ({ id: w.id, label: w.name, code: w.code, active: w.active }));
    },
  };

  const setStockLevel: PromptActionTool<SetStockLevelParams> = {
    id: 'inventory.set_stock_level',
    moduleId: 'inventory',
    kind: 'mutation',
    description:
      'Set the ABSOLUTE on-hand stock quantity of a product in a warehouse. Resolve the product via catalog.search_products and the warehouse via inventory.search_warehouses first. This is captured into a plan the operator must confirm; it is not executed immediately.',
    requiredPermission: 'catalog:write',
    paramsSchema: SetStockLevelParamsSchema,
    preview: async (params, ctx: ToolContext) => {
      const em = ctx.em;
      const product = await em.findOne(Product, { id: params.productId });
      if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      const warehouse = await em.findOne(Warehouse, { id: params.warehouseId });
      if (!warehouse) throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
      const level = await em.findOne(StockLevel, {
        productId: params.productId,
        warehouseId: params.warehouseId,
        variantId: null,
      });
      const current = level?.onHand ?? 0;
      return {
        headline: `Set stock of "${label(product.name)}" in warehouse "${warehouse.name}" to ${params.quantity}`,
        current: { onHand: current },
        affectedCount: 1,
        sample: [{ id: product.id, label: label(product.name) }],
      };
    },
    execute: async (params, ctx: ToolContext) => {
      const result = await stockLevelService.setOnHand(
        {
          productId: params.productId,
          warehouseId: params.warehouseId,
          onHand: params.quantity,
        },
        {
          actorAdminUserId: ctx.adminUserId,
          ipAddress: ctx.auditCtx.ipAddress ?? null,
          userAgent: ctx.auditCtx.userAgent ?? null,
          requestId: ctx.auditCtx.requestId ?? null,
        },
      );
      return { before: result.before, after: result.after };
    },
  };

  return [searchWarehouses as PromptActionTool, setStockLevel as PromptActionTool];
}
