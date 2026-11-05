import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { ComparisonService } from './comparison-service.js';
import { ComparableAttributeProjection } from './comparable-attribute-projection.js';
import { ComparisonProduct } from '../entities/comparison-product.entity.js';
import type { Comparison } from '../entities/comparison.entity.js';

/**
 * Feature 163, owner decision CMP-1 = A (2026-10-26) — a column whose product is not
 * available at the viewer's (channel, language) is the owner's history: the owner keeps
 * it with `available: false`; any other reader gets the `(removed product)` column —
 * no name, SKU, slug, price, image or compared value. The `[PG]` contract test is
 * `backend/test/contract/comparisons/share-unavailable-columns.test.ts`.
 */
const ON = '00000000-0000-4000-8000-000000000001';
const OFF = '00000000-0000-4000-8000-000000000002';
const CHANNEL = '00000000-0000-4000-8000-0000000000c1';

const product = (id: string, sku: string) => ({
  id,
  sku,
  name: sku,
  slug: sku.toLowerCase(),
  type: 'simple',
  visibility: 'public',
  allowedOrganizationIds: [],
  attributeValues: { color: `${sku}-colour` },
  minOrderQuantity: null,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG = '00000000-0000-4000-8000-0000000000d1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000d2';
const OWNER_BUYER = { kind: 'buyer', audience: { organizationId: ORG, authenticated: true } } as const;

/** The channel's effective audience of OFF as `describeChannelAvailability` reads it; `null` = not a member. */
type OffInChannel = { visibility: 'public' | 'organization_restricted'; allowedOrganizationIds: string[] } | null;

function service(offInChannel: OffInChannel = { visibility: 'public', allowedOrganizationIds: [] }) {
  const em = {
    find: async (entity: unknown) =>
      entity === ComparisonProduct
        ? [ON, OFF].map((productId, position) => ({ comparisonId: 'cmp-1', productId, position, addedAt: new Date(position) }))
        : [],
    findOne: async (entity: unknown) =>
      entity === SalesChannel ? { id: CHANNEL, defaultCurrency: 'PLN', defaultLanguage: 'en-US' } : null,
  };
  const catalogProducts = {
    findByIds: async () => [product(ON, 'ON-SKU'), product(OFF, 'OFF-SKU')],
    listValueOverridesByProductIds: async () => [],
  };
  const availability = {
    filterAvailable: vi.fn(async () => new Set([ON])),
    effectiveOrderRules: async () => new Map(),
    describeChannelAvailability: vi.fn(async (ids: readonly string[]) =>
      offInChannel === null || !ids.includes(OFF)
        ? new Map()
        : new Map([[OFF, { liveLanguages: [], window: { from: null, until: null }, audience: offInChannel }]]),
    ),
  };
  const gallery = {
    baseImageUrls: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `https://cdn.test/${id}.jpg`])),
  };
  const attributes = { listByFlag: async () => [{ key: 'color', label: { en: 'Colour' }, valueType: 'string' }] };
  const prices = {
    resolveListingPrices: async ({ products }: { products: Array<{ id: string }> }) =>
      new Map(products.map((p) => [p.id, { amount: '10.00', currency: 'PLN' }])),
  };
  return new ComparisonService(
    () => em as unknown as EntityManager,
    new ComparableAttributeProjection(),
    { generate: () => 'token' } as never,
    catalogProducts as never,
    availability as never,
    gallery as never,
    undefined,
    attributes as never,
    prices as never,
    { findById: async () => null } as never,
  );
}

const comparison = {
  id: 'cmp-1',
  shareToken: 'token',
  displayMode: 'all',
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as unknown as Comparison;

describe('ComparisonService.buildOwnerView — an unavailable column per reader (163 CMP-1)', () => {
  it('the owner keeps the unavailable column as it was, marked unavailable', async () => {
    const view = await service().buildOwnerView(comparison, CHANNEL, undefined, 'owner');
    const off = view.products.find((p) => p.id === OFF)!;
    expect(off).toMatchObject({ sku: 'OFF-SKU', available: false });
    expect(off.primaryAssetUrl).not.toBeNull();
  });

  it('any other reader gets the removed-product column, with no compared value', async () => {
    const view = await service().buildOwnerView(comparison, CHANNEL, undefined, 'recipient');
    const index = 1;
    expect(view.products[index]).toMatchObject({
      sku: '',
      name: '(removed product)',
      slug: '',
      primaryAssetUrl: null,
      price: null,
      available: false,
    });
    for (const row of view.comparableAttributes) expect(row.values[index]).toBeNull();
    expect(view.products.find((p) => p.id === ON)).toMatchObject({ sku: 'ON-SKU', available: true });
    expect(view.hiddenProductCount).toBe(0);
  });

  it('a caller that does not say who is reading is answered as a recipient', async () => {
    const view = await service().buildOwnerView(comparison, CHANNEL);
    expect(view.products[1]).toMatchObject({ sku: '', name: '(removed product)' });
  });

  // Final security review S-L1a — the removed-product column named the product's id,
  // so a recipient learned the UUID of a product they may not see.
  it('a recipient’s removed-product column carries an opaque per-view key, never the product id', async () => {
    const svc = service();
    const first = await svc.buildOwnerView(comparison, CHANNEL, undefined, 'recipient');
    const second = await svc.buildOwnerView(comparison, CHANNEL, undefined, 'recipient');
    const ids = [first.products[1]!.id, second.products[1]!.id];
    for (const id of ids) {
      expect(id).toMatch(UUID);
      expect(id).not.toBe(OFF);
    }
    expect(ids[0]).not.toBe(ids[1]);
    expect(first.products.map((p) => p.id)).not.toContain(OFF);
  });
});

/**
 * Owner decision SEC-2 = A (2026-10-27) — the owner keeps the history column only for
 * a lifecycle reason (off at the scope, archived, outside the window, not a member of
 * the channel). A product the owner may no longer see for an audience reason (the
 * channel's effective audience refuses their organization) collapses to the
 * `(removed product)` column for the owner too, counted nowhere. The operator's audit
 * view (`administrator`) keeps every column.
 */
describe('ComparisonService.buildOwnerView — the owner and an audience refusal (163 SEC-2)', () => {
  const restrictedToOther: OffInChannel = { visibility: 'organization_restricted', allowedOrganizationIds: [OTHER_ORG] };

  it('collapses the owner’s column to the removed-product column when the channel audience refuses them', async () => {
    const owner = await service(restrictedToOther).buildOwnerView(comparison, CHANNEL, OWNER_BUYER, 'owner');
    const recipient = await service(restrictedToOther).buildOwnerView(comparison, CHANNEL, OWNER_BUYER, 'recipient');
    const { id: _ownerId, ...ownerColumn } = owner.products[1]!;
    const { id: _recipientId, ...recipientColumn } = recipient.products[1]!;
    expect(ownerColumn).toEqual(recipientColumn);
    expect(ownerColumn).toMatchObject({ sku: '', name: '(removed product)', price: null, available: false });
    for (const row of owner.comparableAttributes) expect(row.values[1]).toBeNull();
    expect(owner.hiddenProductCount).toBe(recipient.hiddenProductCount);
    expect(owner.hiddenProductCount).toBe(0);
    // The owner added it and removes it by this id (`DELETE /me/products/:productId`).
    expect(owner.products[1]!.id).toBe(OFF);
  });

  it('keeps the owner’s history column for a lifecycle reason the audience does not explain', async () => {
    const view = await service().buildOwnerView(comparison, CHANNEL, OWNER_BUYER, 'owner');
    expect(view.products[1]).toMatchObject({ id: OFF, sku: 'OFF-SKU', available: false });
  });

  it('keeps the owner’s history column when the product left the channel', async () => {
    const view = await service(null).buildOwnerView(comparison, CHANNEL, OWNER_BUYER, 'owner');
    expect(view.products[1]).toMatchObject({ id: OFF, sku: 'OFF-SKU', available: false });
  });

  it('keeps the column on the operator’s audit view, which reads as the owner keeps it', async () => {
    const view = await service(restrictedToOther).buildOwnerView(comparison, CHANNEL, { kind: 'administrator' }, 'owner');
    expect(view.products[1]).toMatchObject({ id: OFF, sku: 'OFF-SKU', available: false });
  });
});
