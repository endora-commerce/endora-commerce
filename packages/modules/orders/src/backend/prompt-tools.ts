import {
  BulkSetOrderStatusParamsSchema,
  SearchOrdersParamsSchema,
  SetOrderStatusParamsSchema,
  type BulkSetOrderStatusParams,
  type SearchOrdersParams,
  type CustomerAccountReadPort,
  type OrganizationDetailsPort,
  type PromptActionTool,
  type SetOrderStatusParams,
  type ToolContext,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { Order } from './entities/order.entity.js';
import { OrderStatusGraphService } from './services/order-status-graph-service.js';
import { OrderListService } from './services/order-list-service.js';
import type { OrderTransitionService } from './services/order-transition-service.js';

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
  /**
   * The two name searches the assistant's order resolver runs behind its `q`
   * (feature 075). `OrderListService` resolves the organisation and the
   * customer a term names through their owners' ports, so this file hands the
   * same two down rather than letting the list build them.
   */
  organizationDetails: OrganizationDetailsPort;
  customerAccountRead: CustomerAccountReadPort;
  /**
   * Late-bound accessor for the configured OrderTransitionService (exposed by
   * the orders plugin at boot). Status-change tools call it at confirm time —
   * long after boot — so a getter is sufficient. Omit it to ship only the
   * read-only resolver (e.g. in tests).
   */
  getTransitionService?: () => OrderTransitionService | null;
}

const RESULT_LIMIT = 20;

function statusLabel(name: Record<string, string>, code: string): string {
  return name['en'] ?? Object.values(name)[0] ?? code;
}

export function ordersPromptTools(deps: OrdersPromptToolsDeps): PromptActionTool[] {
  const graphService = new OrderStatusGraphService(deps.emFactory);
  const listService = new OrderListService(
    deps.emFactory,
    graphService,
    deps.organizationDetails,
    deps.customerAccountRead,
  );

  function requireTransitionService(): OrderTransitionService {
    const svc = deps.getTransitionService?.() ?? null;
    if (!svc) {
      throw new HttpError(503, 'INTERNAL', 'The order status engine is not available.');
    }
    return svc;
  }

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

  /** Build the from→to preview for a single order, validating the transition. */
  async function previewOrderTransition(
    em: EntityManager,
    orderId: string,
    toStatusCode: string,
  ): Promise<{ headline: string; current: unknown; affectedCount: number; sample: Array<{ id: string; label: string }> }> {
    const order = await em.findOne(Order, { id: orderId });
    if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const graph = await graphService.loadGraph();
    if (!graph.has(toStatusCode)) {
      throw new HttpError(422, 'VALIDATION_FAILED', `Unknown order status "${toStatusCode}".`);
    }
    if (!graph.canTransition(order.status, toStatusCode)) {
      const allowed = graph.allowedTargets(order.status).join(', ') || '(none)';
      throw new HttpError(
        409,
        'INVALID_TRANSITION',
        `Order ${order.businessId} cannot move from "${order.status}" to "${toStatusCode}". Allowed next statuses: ${allowed}.`,
      );
    }
    const fromLabel = statusLabel(graph.get(order.status)?.name ?? {}, order.status);
    const toLabel = statusLabel(graph.get(toStatusCode)?.name ?? {}, toStatusCode);
    return {
      headline: `Change order ${order.businessId} status from "${fromLabel}" to "${toLabel}"`,
      current: { status: order.status },
      affectedCount: 1,
      sample: [{ id: order.id, label: order.businessId }],
    };
  }

  const setOrderStatus: PromptActionTool<SetOrderStatusParams> = {
    id: 'orders.set_order_status',
    moduleId: 'orders',
    kind: 'mutation',
    description:
      'Change a single order\'s status to a target status reachable from its current status by the configured transition graph. Resolve the order via orders.search_orders first. Captured into a plan the operator must confirm; not executed immediately.',
    requiredPermission: 'orders:write',
    paramsSchema: SetOrderStatusParamsSchema,
    // D-75 — this module's own fork, not the caller's manager: the preview
    // reads committed order rows and writes nothing.
    preview: async (params) =>
      previewOrderTransition(deps.emFactory(), params.orderId, params.toStatusCode),
    execute: async (params, ctx: ToolContext) => {
      const order = await requireTransitionService().apply(
        params.orderId,
        params.toStatusCode,
        { kind: 'admin', adminUserId: ctx.adminUserId },
        params.reason ?? null,
      );
      return { orderId: order.id, status: order.status };
    },
  };

  const bulkSetOrderStatus: PromptActionTool<BulkSetOrderStatusParams> = {
    id: 'orders.bulk_set_order_status',
    moduleId: 'orders',
    kind: 'mutation',
    description:
      'Change the status of several orders to the same target status. Each order is transitioned only when the move is valid for its current status; the rest are skipped and reported. Resolve orders via orders.search_orders first. Captured into a plan the operator must confirm; not executed immediately.',
    requiredPermission: 'orders:write',
    paramsSchema: BulkSetOrderStatusParamsSchema,
    preview: async (params) => {
      const em = deps.emFactory();
      const graph = await graphService.loadGraph();
      if (!graph.has(params.toStatusCode)) {
        throw new HttpError(422, 'VALIDATION_FAILED', `Unknown order status "${params.toStatusCode}".`);
      }
      const orders = await em.find(Order, { id: { $in: params.orderIds } }, { fields: ['id', 'businessId', 'status'] });
      const eligible = orders.filter((o) => graph.canTransition(o.status, params.toStatusCode));
      const toLabel = statusLabel(graph.get(params.toStatusCode)?.name ?? {}, params.toStatusCode);
      return {
        headline: `Change ${eligible.length} of ${params.orderIds.length} order(s) to "${toLabel}" (others skipped as invalid transitions)`,
        affectedCount: eligible.length,
        sample: eligible.slice(0, 10).map((o) => ({ id: o.id, label: o.businessId })),
      };
    },
    execute: async (params, ctx: ToolContext) => {
      const transitionService = requireTransitionService();
      const actor = { kind: 'admin' as const, adminUserId: ctx.adminUserId };
      let succeeded = 0;
      const failures: Array<{ id: string; reason: string }> = [];
      for (const orderId of params.orderIds) {
        try {
          await transitionService.apply(orderId, params.toStatusCode, actor, params.reason ?? null);
          succeeded += 1;
        } catch (err) {
          // Issue #278 — first, and unconditionally. The tolerance below is
          // right for a refusal that is *about this order*: an unknown status,
          // a terminal one, or a before-guard's veto, each of which the operator
          // reads next to the orders that did move. A switched-off module is
          // none of those. It is the same answer for every remaining order, so
          // absorbing it turns one fixable cause into N identical `failed` rows
          // — and `OrderTransitionService.apply` flushes the status change
          // *before* it runs the side-effects hook that reaches
          // `credit_limits`' release port, so those rows would report `failed`
          // for orders whose status had in fact already moved. Re-throwing
          // stops the batch and hands the operator the 503 `MODULE_DISABLED`
          // envelope, which names the module they have to switch on; re-running
          // afterwards is safe, because an order already at the target status
          // is a no-op transition.
          rethrowIfModuleDisabled(err);
          failures.push({
            id: orderId,
            reason: err instanceof HttpError ? err.message : 'failed',
          });
        }
      }
      return {
        summary: {
          total: params.orderIds.length,
          succeeded,
          failed: failures.length,
          failures: failures.slice(0, 50),
        },
      };
    },
  };

  return [
    searchOrders as PromptActionTool,
    setOrderStatus as PromptActionTool,
    bulkSetOrderStatus as PromptActionTool,
  ];
}
