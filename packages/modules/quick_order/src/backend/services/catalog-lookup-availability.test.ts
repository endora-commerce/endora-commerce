import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProductReadPort, ProductAudience } from '@endora-commerce/contracts';

const channelState: { current: { id: string } | null } = { current: null };
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/platform/kernel')>()),
  currentSalesChannel: () => channelState.current,
}));

const { CatalogPortLookup } = await import('./catalog-lookup.js');

/**
 * Feature 163 (FR-004, QA checkpoint B) — a pasted SKU list resolves only the
 * products `catalog` says are available at the request channel, in its default
 * language, to the buyer. A product that is switched off, outside its window or
 * restricted there reads as an SKU that does not exist.
 */
const BUYER: ProductAudience = { organizationId: 'org-x', authenticated: true };
const rec = (id: string, sku: string) =>
  ({ id, sku, status: 'active', deletedAt: null, type: 'simple', minOrderQuantity: null, visibility: 'public', allowedOrganizationIds: [] }) as never;

function lookup(live: string[]) {
  const filterAvailable = vi.fn(async (ids: readonly string[]) => new Set(ids.filter((id) => live.includes(id))));
  const catalogProducts = {
    findBySkus: vi.fn(async () => [rec('p-on', 'ON'), rec('p-off', 'OFF')]),
  } as unknown as CatalogProductReadPort;
  // `effectiveOrderRules` is the port's other half; SKU lookup never reads it.
  const effectiveOrderRules = vi.fn();
  return { filterAvailable, subject: new CatalogPortLookup(catalogProducts, { filterAvailable, effectiveOrderRules }) };
}

beforeEach(() => {
  channelState.current = { id: 'channel-b2b' };
});

describe('CatalogPortLookup.findProductsBySku — availability (163)', () => {
  it('returns only the SKUs available at the request channel; the unavailable one is simply unknown', async () => {
    const { subject, filterAvailable } = lookup(['p-on']);
    const out = await subject.findProductsBySku(['ON', 'OFF'], BUYER);
    expect(out.map((p) => p.sku)).toEqual(['ON']);
    expect(filterAvailable).toHaveBeenCalledWith(['p-on', 'p-off'], {
      channelId: 'channel-b2b',
      languageCode: null,
      audience: BUYER,
    });
  });

  it('a list of SKUs that are all unavailable resolves to nothing', async () => {
    const { subject } = lookup([]);
    expect(await subject.findProductsBySku(['ON', 'OFF'], BUYER)).toEqual([]);
  });

  it("'unrestricted' (operator import) skips the port and keeps everything", async () => {
    const { subject, filterAvailable } = lookup([]);
    expect(await subject.findProductsBySku(['ON', 'OFF'], 'unrestricted')).toHaveLength(2);
    expect(filterAvailable).not.toHaveBeenCalled();
  });

  it('security review (checkpoint B) — a channel the route names is asked even with no request scope', async () => {
    channelState.current = null;
    const { subject, filterAvailable } = lookup(['p-on']);
    const out = await subject.findProductsBySku(['ON', 'OFF'], BUYER, 'channel-named');
    expect(out.map((p) => p.sku)).toEqual(['ON']);
    expect(filterAvailable).toHaveBeenCalledWith(['p-on', 'p-off'], {
      channelId: 'channel-named',
      languageCode: null,
      audience: BUYER,
    });
  });

  it('records the pre-existing outside-a-request behaviour: no channel -> audience filter alone, port not asked', async () => {
    channelState.current = null;
    const { subject, filterAvailable } = lookup([]);
    expect(await subject.findProductsBySku(['ON', 'OFF'], BUYER)).toHaveLength(2);
    expect(filterAvailable).not.toHaveBeenCalled();
  });
});
