import { describe, expect, it } from 'vitest';
import type { CustomerAccountReadPort, OrganizationDetailsPort } from '@endora-commerce/contracts';
import { HttpError } from '../../../src/http/error-envelope.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { PromptActionToolRegistry } from '../../../../packages/modules/prompt_actions/src/backend/services/tool-registry.js';
import { ordersPromptTools } from '../../../../packages/modules/orders/src/backend/prompt-tools.js';
import type { OrderTransitionService } from '../../../../packages/modules/orders/src/backend/services/order-transition-service.js';

/**
 * Per-module tool-contribution contract (feature 043): the orders module
 * contributes assistant tools as a flat PromptActionTool[] that the shared
 * registry accepts without `prompt_actions` knowing anything about orders.
 *
 * It lived at `src/modules/orders/prompt-tools.test.ts` until feature 075. A
 * test file under `src/` is in `check:module-boundary`'s scope, so its import
 * of the host registry read as this module naming another module's internals;
 * under `backend/test/` the same import is reporting-only, which is where the
 * repository already keeps every other cross-module test fixture.
 */

// The provider only constructs services lazily; a no-op emFactory is enough to
// inspect the contributed tool metadata.
const deps = {
  emFactory: (() => ({})) as never,
  // The two neighbour ports the order resolver's list search reads. The tool
  // metadata this suite inspects is built without touching either, so a
  // refusing stub keeps the fixture honest: if a tool ever resolves one at
  // construction time, the throw says so instead of a silent empty answer.
  organizationDetails: refusing<OrganizationDetailsPort>('organizationDetailsPort'),
  customerAccountRead: refusing<CustomerAccountReadPort>('customerAccountReadPort'),
};

const ORDER_A = '11111111-1111-4111-8111-111111111111';
const ORDER_B = '22222222-2222-4222-8222-222222222222';
const ACTOR = { adminUserId: 'a', requestId: 'r', auditCtx: {} };

/**
 * The bulk tool wired to a transition engine that refuses every order the same
 * way — the only thing these two cases differ on is *how* it refuses.
 */
function bulkTool(refuse: () => never) {
  const tools = ordersPromptTools({
    ...deps,
    getTransitionService: () =>
      ({
        apply: async () => refuse(),
      }) as unknown as OrderTransitionService,
  });
  const bulk = tools.find((tool) => tool.id === 'orders.bulk_set_order_status');
  if (!bulk) throw new Error('orders.bulk_set_order_status is not contributed');
  return bulk;
}

function refusing<T>(name: string): T {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`prompt-tools fixture: ${name} was not expected to be called`);
      },
    },
  ) as T;
}

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

  it('bulk_set_order_status keeps reporting an ordinary per-item refusal', async () => {
    const bulk = bulkTool(() => {
      throw new HttpError(409, 'INVALID_TRANSITION', 'Cannot transition from "new" to "shipped".');
    });
    const result = (await bulk.execute(
      { orderIds: [ORDER_A, ORDER_B], toStatusCode: 'shipped' },
      ACTOR,
    )) as { summary: { total: number; succeeded: number; failed: number } };
    // Both items are refused and the tool still answers — that tolerance is the
    // requirement, and narrowing it for `ModuleDisabledError` must not touch it.
    expect(result.summary).toMatchObject({ total: 2, succeeded: 0, failed: 2 });
  });

  it('bulk_set_order_status surfaces a switched-off module instead of counting it as a failed item', async () => {
    // Issue #278. `OrderTransitionService.apply` flushes the status change and
    // *then* runs the side-effects hook, which calls `credit_limits`' gated
    // release port. With that module off, the swallowed 503 became a per-item
    // `failed` row for an order whose status had in fact already moved, and the
    // loop went on doing it to every remaining order in the batch.
    const disabled = new ModuleDisabledError('credit_limits');
    const bulk = bulkTool(() => {
      throw disabled;
    });
    await expect(
      bulk.execute({ orderIds: [ORDER_A, ORDER_B], toStatusCode: 'cancelled' }, ACTOR),
    ).rejects.toBe(disabled);
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
