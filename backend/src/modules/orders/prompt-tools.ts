import { SearchOrdersParamsSchema, type SearchOrdersParams } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { OrderStatusGraphService } from './services/order-status-graph-service.js';
import { OrderListService } from './services/order-list-service.js';
import type { PromptActionTool } from '../prompt_actions/services/tool-registry.js';

/**
 * Orders' contribution to the prompt-assistant tool catalogue (feature 043).
 *
 * Per the per-module tool-contribution contract (see
 * `prompt_actions/PROMPT_TOOLS.md`), the orders module owns the `orders.*`
 * tools: it never reaches into `prompt_actions`, it only exports a flat
 * `PromptActionTool[]` that composition registers into the shared registry.
 *
 * This file ships the read-only `orders.search_orders` resolver; the order
 * status-change mutations are layered on top of the same provider.
 */

export interface OrdersPromptToolsDeps {
  emFactory: () => EntityManager;
}

const RESULT_LIMIT = 20;

function statusLabel(name: Record<string, string>, code: string): string {
  return name['en'] ?? Object.values(name)[0] ?? code;
}

export function ordersPromptTools(deps: OrdersPromptToolsDeps): PromptActionTool[] {
  const graphService = new OrderStatusGraphService(deps.emFactory);
  const listService = new OrderListService(deps.emFactory, graphService);

  const searchOrders: PromptActionTool<SearchOrdersParams> = {
    id: 'orders.search_orders',
    moduleId: 'orders',
    kind: 'resolver',
    description:
      'Search orders by business ID, customer name or organization name fragment (case-insensitive). Returns up to 20 matches as {id, businessId, status, statusLabel, label}. Use the returned id in order mutation tools; never invent ids.',
    requiredPermission: 'orders:read',
    paramsSchema: SearchOrdersParamsSchema,
    execute: async (params) => {
      const { rows } = await listService.list({ q: params.q, page: 1, pageSize: RESULT_LIMIT });
      return rows.map((r) => ({
        id: r.id,
        businessId: r.businessId,
        status: r.status,
        statusLabel: statusLabel(r.statusName, r.status),
        label: r.organizationName ? `${r.businessId} — ${r.organizationName}` : r.businessId,
      }));
    },
  };

  return [searchOrders as PromptActionTool];
}
