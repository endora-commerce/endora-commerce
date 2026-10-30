import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SearchEventSubscriber } from './search-event-subscriber.js';
import type { SearchIndexer } from './search-indexer.js';

/**
 * Issue #240 — a product's channel memberships decide which indexes hold it, so
 * a change to them reindexes the product.
 *
 * `search` listened to product events only. A created product is bound to the
 * default channel after `product.created.v1` has been dispatched, so it was met
 * with no channel and indexed nowhere until a later edit. The binding emits
 * `sales_channels.membership_changed` once the membership exists; this handler
 * is what turns that into a reindex. The end-to-end property — created through
 * the admin API, present in Meilisearch without an edit — is
 * `backend/test/integration/search/created-product-indexed.test.ts`.
 */

function harness(upsert: (...args: unknown[]) => Promise<string[]> = async () => ['default']) {
  const upsertProduct = vi.fn(upsert);
  const onError = vi.fn();
  const subscriber = new SearchEventSubscriber({
    emFactory: () => ({}) as EntityManager,
    indexer: { upsertProduct } as unknown as SearchIndexer,
    onError,
  });
  return { subscriber, upsertProduct, onError };
}

describe('SearchEventSubscriber.onSalesChannelMembershipChanged', () => {
  it.each(['add', 'remove'] as const)('reindexes a product whose membership changed (%s)', async (op) => {
    const h = harness();

    await h.subscriber.onSalesChannelMembershipChanged({
      channelId: 'chan-1',
      entityType: 'product',
      entityId: 'product-1',
      op,
    });

    // `upsertProduct` reconciles every channel index against the product's
    // memberships — adding where it is a member, removing where it is not — so
    // one call answers both directions.
    expect(h.upsertProduct).toHaveBeenCalledTimes(1);
    expect(h.upsertProduct.mock.calls[0]![1]).toBe('product-1');
  });

  it('ignores memberships of anything that is not a product', async () => {
    const h = harness();

    await h.subscriber.onSalesChannelMembershipChanged({
      channelId: 'chan-1',
      entityType: 'cms_page',
      entityId: 'page-1',
      op: 'add',
    });

    expect(h.upsertProduct).not.toHaveBeenCalled();
  });

  it('swallows an index failure like every other handler, and reports it', async () => {
    const h = harness(async () => {
      throw new Error('meilisearch down');
    });

    await expect(
      h.subscriber.onSalesChannelMembershipChanged({
        channelId: 'chan-1',
        entityType: 'product',
        entityId: 'product-1',
        op: 'add',
      }),
    ).resolves.toBeUndefined();
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError.mock.calls[0]![1]).toBe('sales_channels.membership_changed');
  });
});
