import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type {
  CartWithItems,
  CartWritePort,
  CatalogProductReadPort,
  CatalogProductRecord,
  QuoteRequest,
  RfqCustomerPort,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { ShoppingListService } from '../../../../packages/modules/shopping_lists/src/backend/services/shopping-list-service.js';

/**
 * Feature 075, Phase C — `shopping_lists` asks `catalog` for its rows and
 * reaches `carts` and `quote_requests` through their published ports (FR-012).
 *
 * The `catalog` edge was an `em.findOne(Product, …)` / `em.find(Product, …)`
 * written from inside this module, which is the shape Principle XVII cannot
 * gate: deactivation drops no tables, so a list went on accepting items and
 * partitioning them by product status out of a `catalog` an operator had
 * switched off. The other four were type-only imports of two service classes
 * this module already resolved by container name.
 *
 * These cases assert the demand rather than the plumbing: an `EntityManager`
 * that **refuses** to serve a foreign entity, plus stub ports, must be enough.
 * A fake that would notice the old query is what makes the test able to fail.
 */

const CTX = { customerAccountId: 'cust-1', organizationId: 'org-1' };

function productRecord(
  id: string,
  overrides: Partial<CatalogProductRecord> = {},
): CatalogProductRecord {
  return {
    id,
    sku: `SKU-${id}`,
    slug: `slug-${id}`,
    type: 'simple',
    status: 'active',
    name: { en: `Product ${id}` },
    description: {},
    stockMode: null,
    visibility: 'public',
    attributeValues: {},
    allowedOrganizationIds: [],
    attributeSetId: 'set-1',
    downloadAssetId: null,
    downloadUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
    deletedAt: null,
    manageStock: false,
    backorderEnabled: false,
    lowStockThreshold: null,
    lowStockThresholdMode: 'cumulative',
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    ...overrides,
  };
}

/**
 * An `EntityManager` that serves this module's own rows and refuses every other
 * module's. `handlers` is keyed by entity class name.
 */
function fakeEm(handlers: Record<string, unknown>): () => EntityManager {
  const dispatch = (entity: { name?: string }, fallback: unknown): unknown => {
    const name = entity.name ?? '(anonymous)';
    if (!(name in handlers)) {
      throw new Error(
        `shopping_lists queried '${name}' directly — that row belongs to another module`,
      );
    }
    return handlers[name] ?? fallback;
  };
  const em = {
    findOne: async (entity: { name?: string }) => dispatch(entity, null),
    find: async (entity: { name?: string }) => dispatch(entity, []),
    count: async () => 0,
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'row-1', ...data }),
    persistAndFlush: async () => undefined,
    flush: async () => undefined,
  };
  return () => em as unknown as EntityManager;
}

/**
 * Issue #259 — outside a request there is no resolved channel, so the seam has
 * nothing to narrow against and must not ask the bridge at all. A membership
 * port that throws on every method is how that is asserted rather than assumed:
 * a `productIdsInRequestChannel` that fabricated the system-default channel
 * here would take the whole file red.
 */
const refusingChannelMembership = new Proxy(
  {},
  {
    get: (_target, property) => () => {
      throw new Error(
        `shopping_lists asked the channel bridge (${String(property)}) with no request channel`,
      );
    },
  },
) as SalesChannelMembershipPort;

const refusingCarts = new Proxy(
  {},
  {
    get: (_target, property) => () => {
      throw new Error(`shopping_lists unexpectedly called carts.${String(property)}`);
    },
  },
) as CartWritePort;

const refusingRfq = new Proxy(
  {},
  {
    get: (_target, property) => () => {
      throw new Error(`shopping_lists unexpectedly called quote_requests.${String(property)}`);
    },
  },
) as RfqCustomerPort;

const LIST = { id: 'list-1', isDefault: false, updatedAt: new Date('2026-01-01T00:00:00.000Z') };

describe('shopping_lists — product rows arrive over catalogProductReadPort', () => {
  it('checks a new item against the port, and never the catalog table', async () => {
    const asked: string[] = [];
    const catalogProducts = {
      findById: async (id: string) => {
        asked.push(id);
        return productRecord(id);
      },
    } as unknown as CatalogProductReadPort;

    const service = new ShoppingListService(
      fakeEm({ ShoppingList: LIST, ShoppingListItem: [] }),
      refusingCarts,
      refusingRfq,
      catalogProducts,
      refusingChannelMembership,
    );

    const item = await service.addItem(CTX, 'list-1', { productId: 'prod-9', quantity: 3 });

    expect(asked).toEqual(['prod-9']);
    expect(item.productId).toBe('prod-9');
  });

  it('refuses an item whose product the port does not know', async () => {
    const catalogProducts = {
      findById: async () => null,
    } as unknown as CatalogProductReadPort;

    const service = new ShoppingListService(
      fakeEm({ ShoppingList: LIST, ShoppingListItem: [] }),
      refusingCarts,
      refusingRfq,
      catalogProducts,
      refusingChannelMembership,
    );

    await expect(
      service.addItem(CTX, 'list-1', { productId: 'prod-9', quantity: 1 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('shopping_lists — conversion partitions by the port, and writes through ports', () => {
  const items = [
    { id: 'item-1', productId: 'prod-live', quantity: 2, variantId: null, note: null },
    { id: 'item-2', productId: 'prod-archived', quantity: 1, variantId: null, note: null },
    { id: 'item-3', productId: 'prod-gone', quantity: 5, variantId: null, note: null },
  ];

  const catalogProducts = {
    findByIds: async (ids: readonly string[]) =>
      ids
        .filter((id) => id !== 'prod-gone')
        .map((id) =>
          id === 'prod-archived' ? productRecord(id, { status: 'inactive' }) : productRecord(id),
        ),
  } as unknown as CatalogProductReadPort;

  it('adds only the live lines to the cart, over cartWritePort', async () => {
    const added: string[] = [];
    const carts = {
      addItem: async (_actor: unknown, input: { productId: string }) => {
        added.push(input.productId);
        return {} as CartWithItems;
      },
    } as unknown as CartWritePort;

    const service = new ShoppingListService(
      fakeEm({ ShoppingList: LIST, ShoppingListItem: items }),
      carts,
      refusingRfq,
      catalogProducts,
      refusingChannelMembership,
    );

    const result = await service.convertToCart(CTX, 'list-1', undefined);

    expect(added).toEqual(['prod-live']);
    expect(result.added).toBe(1);
    expect(result.skipped).toEqual([
      { itemId: 'item-2', productId: 'prod-archived', reason: 'product_archived' },
      { itemId: 'item-3', productId: 'prod-gone', reason: 'product_not_found' },
    ]);
  });

  it('quotes only the live lines, over rfqCustomerPort', async () => {
    const quoted: string[] = [];
    const rfq = {
      createForCustomer: async (_ctx: unknown, input: { items: { productId: string }[] }) => {
        quoted.push(...input.items.map((i) => i.productId));
        return { id: 'rfq-1' } as QuoteRequest;
      },
    } as unknown as RfqCustomerPort;

    const service = new ShoppingListService(
      fakeEm({ ShoppingList: LIST, ShoppingListItem: items }),
      refusingCarts,
      rfq,
      catalogProducts,
      refusingChannelMembership,
    );

    const result = await service.convertToRfq(CTX, 'list-1', undefined);

    expect(quoted).toEqual(['prod-live']);
    expect(result.rfqId).toBe('rfq-1');
    expect(result.added).toBe(1);
    expect(result.skipped.map((s) => s.reason)).toEqual([
      'product_archived',
      'product_not_found',
    ]);
  });
});
