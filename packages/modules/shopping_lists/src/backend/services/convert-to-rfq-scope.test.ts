import type { EntityManager } from '@mikro-orm/postgresql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CartWritePort,
  CatalogProductReadPort,
  QuoteRequest,
  RfqCustomerPort,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

const channelState: { current: { id: string; languages: string[]; defaultLanguage: string } | null } = {
  current: null,
};
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/platform/kernel')>()),
  currentSalesChannel: () => channelState.current,
}));

const { ShoppingListService } = await import(
  './shopping-list-service.js'
);

/**
 * Feature 163 (FR-018; code review of the T155 fix round) — a shopping list
 * converted into a quote request is judged at the request's (channel, scope
 * language), the rule every buyer seam follows (`consumers.md`): the lines are
 * partitioned at the scope language the request's tag resolves to, and the quote
 * request is created with the tag and the channel, so `quote_requests` asks the
 * same question. It used to ask at the channel's default language.
 */

const B2C = '00000000-0000-4000-8000-0000000000d1';
const CTX = { customerAccountId: 'cust-1', organizationId: 'org-1' };
// A uuid: a malformed id names no list and is refused before any read (issue #753).
const LIST_ID = '00000000-0000-4000-8000-0000000000e2';
const LIST = { id: LIST_ID, isDefault: false, updatedAt: new Date('2026-01-01T00:00:00.000Z') };
const ITEMS = [{ id: 'item-1', productId: 'prod-1', quantity: 1, variantId: null, note: null }];

function fakeEm(): () => EntityManager {
  const em = {
    findOne: async () => LIST,
    find: async () => ITEMS,
  };
  return () => em as unknown as EntityManager;
}

function rig() {
  const createForCustomer = vi.fn(async () => ({ id: 'rfq-1' }) as QuoteRequest);
  const filterAvailable = vi.fn(async (ids: readonly string[]) => new Set(ids));
  const service = new ShoppingListService(
    fakeEm(),
    {} as CartWritePort,
    { createForCustomer } as unknown as RfqCustomerPort,
    {
      findByIds: async (ids: readonly string[]) =>
        ids.map((id) => ({ id, status: 'active', archivedAt: null, deletedAt: null, visibility: 'public', allowedOrganizationIds: [] })),
    } as unknown as CatalogProductReadPort,
    { filterEntityIdsInChannel: async (_c: string, _t: string, ids: readonly string[]) => [...ids] } as unknown as SalesChannelMembershipPort,
    { filterAvailable },
  );
  return { service, createForCustomer, filterAvailable };
}

beforeEach(() => {
  channelState.current = { id: B2C, languages: ['pl-PL', 'de-DE'], defaultLanguage: 'pl-PL' };
});

describe('163 — shopping list → quote request at the request’s scope language', () => {
  it('partitions the lines at the scope language the request tag resolves to', async () => {
    const { service, filterAvailable } = rig();
    await service.convertToRfq(CTX, LIST_ID, undefined, { language: 'pl', languageTag: 'de-DE', salesChannelId: B2C });
    expect(filterAvailable).toHaveBeenCalledWith(['prod-1'], expect.objectContaining({ channelId: B2C, languageCode: 'de-DE' }));
  });

  it('creates the quote request with the request’s tag and channel beside the message language', async () => {
    const { service, createForCustomer } = rig();
    await service.convertToRfq(CTX, LIST_ID, undefined, { language: 'pl', languageTag: 'de-DE', salesChannelId: B2C });
    expect(createForCustomer).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      language: 'pl',
      languageTag: 'de-DE',
      salesChannelId: B2C,
    });
  });
});
