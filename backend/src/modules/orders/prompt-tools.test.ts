import { describe, expect, it } from 'vitest';
import { PromptActionToolRegistry } from '../prompt_actions/services/tool-registry.js';
import { ordersPromptTools } from './prompt-tools.js';

/**
 * Per-module tool-contribution contract (feature 043): the orders module
 * contributes assistant tools as a flat PromptActionTool[] that the shared
 * registry accepts without `prompt_actions` knowing anything about orders.
 */

// The provider only constructs services lazily; a no-op emFactory is enough to
// inspect the contributed tool metadata.
const deps = { emFactory: (() => ({})) as never };

describe('ordersPromptTools — per-module registration', () => {
  it('contributes well-formed orders.* tools that the shared registry accepts', () => {
    const registry = new PromptActionToolRegistry();
    const tools = ordersPromptTools(deps);
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.id.startsWith('orders.')).toBe(true);
      expect(t.moduleId).toBe('orders');
      // Registration enforces id-prefixing, uniqueness, and the mutation
      // preview rule — a throw here means the contract was violated.
      expect(() => registry.register(t)).not.toThrow();
    }
    expect(registry.get('orders.search_orders')?.requiredPermission).toBe('orders:read');
  });

  it('search_orders validates its params via the contract schema', () => {
    const searchOrders = ordersPromptTools(deps).find((t) => t.id === 'orders.search_orders');
    expect(searchOrders).toBeDefined();
    expect(searchOrders!.kind).toBe('resolver');
    expect(searchOrders!.paramsSchema.safeParse({ q: 'ORD-1' }).success).toBe(true);
    expect(searchOrders!.paramsSchema.safeParse({ q: '' }).success).toBe(false);
  });

  it('exposes status-change mutations with a preview and write permission', () => {
    const ids = ordersPromptTools(deps).map((t) => t.id);
    expect(ids).toContain('orders.set_order_status');
    expect(ids).toContain('orders.bulk_set_order_status');
    for (const tool of ordersPromptTools(deps).filter((t) => t.kind === 'mutation')) {
      expect(typeof tool.preview).toBe('function');
      expect(tool.requiredPermission).toBe('orders:write');
    }
  });

  it('set_order_status fails clearly at execute time when the engine is unavailable', async () => {
    const setOrderStatus = ordersPromptTools(deps).find((t) => t.id === 'orders.set_order_status');
    await expect(
      setOrderStatus!.execute(
        { orderId: '00000000-0000-0000-0000-000000000000', toStatusCode: 'cancelled' },
        { adminUserId: 'a', requestId: 'r', auditCtx: {} },
      ),
    ).rejects.toThrow(/not available/i);
  });
});
