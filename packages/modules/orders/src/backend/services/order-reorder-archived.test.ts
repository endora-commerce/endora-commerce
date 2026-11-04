import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CartWritePort,
  CatalogProductReadPort,
  CatalogProductRecord,
  CustomerAccountReadPort,
  OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import { OrderReorderService } from './order-reorder-service.js';

/**
 * Feature 163, spec Session 2026-10-25 (T156l; FR-010, FR-019) — a reorder reads
 * "archived" from `archivedAt`, never from the status. An archived product is
 * reported `discontinued` and left out, whatever its status; a product that is
 * merely switched off (`inactive`, not archived) is seeded like any other line and
 * left to the cart and to placement to refuse (consumers row 20).
 */

const ORDER = {
  id: 'order-1',
  organizationId: 'org-1',
  salesChannelId: 'channel-1',
  currency: 'PLN',
  businessId: 'ORD-1',
};

function line(productId: string, position: number) {
  return {
    id: `line-${productId}`,
    orderId: ORDER.id,
    productId,
    variantId: null,
    quantity: 1,
    unitPrice: '10.00',
    groupId: null,
    position,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

const LINES = [line('p-live', 0), line('p-off', 1), line('p-archived-on', 2), line('p-archived-off', 3)];

function record(id: string, over: Partial<CatalogProductRecord>): CatalogProductRecord {
  return { id, status: 'active', archivedAt: null, deletedAt: null, ...over } as CatalogProductRecord;
}

const PRODUCTS: Record<string, CatalogProductRecord> = {
  'p-live': record('p-live', {}),
  'p-off': record('p-off', { status: 'inactive' }),
  'p-archived-on': record('p-archived-on', { status: 'active', archivedAt: new Date() }),
  'p-archived-off': record('p-archived-off', { status: 'inactive', archivedAt: new Date() }),
};

function fakeEm(): () => EntityManager {
  const em = {
    findOne: async () => ORDER,
    find: async (entity: { name?: string }) => (entity.name === 'OrderItem' ? LINES : []),
  };
  return () => em as unknown as EntityManager;
}

describe('OrderReorderService — archived is archivedAt (spec 163)', () => {
  it('drops archived products as discontinued and seeds a switched-off one', async () => {
    const seeded: string[] = [];
    const cartWrite = {
      replaceItemsForCustomer: async (_actor: unknown, lines: ReadonlyArray<{ productId: string }>) => {
        seeded.push(...lines.map((l) => l.productId));
        return { cart: { id: 'cart-1' }, items: [], unorderable: [] };
      },
    } as unknown as CartWritePort;
    const catalogProductRead = {
      findByIds: async (ids: readonly string[]) => ids.map((id) => PRODUCTS[id]).filter(Boolean),
    } as unknown as CatalogProductReadPort;
    const service = new OrderReorderService(
      fakeEm(),
      cartWrite,
      catalogProductRead,
      { findById: async () => null } as unknown as CustomerAccountReadPort,
      { can: async () => false } as unknown as OrganizationPermissionPort,
    );

    const result = await service.reorder(ORDER.id, {
      customerAccountId: 'cust-1',
      organizationId: 'org-1',
      salesChannelId: 'channel-1',
    });

    expect(seeded).toEqual(['p-live', 'p-off']);
    expect(result.unavailableItems).toEqual([
      { productId: 'p-archived-on', variantId: null, reason: 'discontinued' },
      { productId: 'p-archived-off', variantId: null, reason: 'discontinued' },
    ]);
  });
});
