import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBase, EventBus } from '../../../events/bus.js';
import type { SearchIndexer } from './search-indexer.js';

/**
 * SearchEventSubscriber (T067 — incremental upsert path).
 *
 * Wires the in-process event bus to the SearchIndexer so the per-channel
 * Meilisearch indexes stay in sync with Postgres without an offline
 * reindex on every catalog mutation:
 *
 *   - `product.created.v1`  → upsertProduct
 *   - `product.updated.v1`  → upsertProduct
 *   - `product.archived.v1` → deleteProduct
 *   - `attribute.updated.v1` → refreshAttributeSettings
 *
 * Handlers swallow their own errors so a transient Meilisearch outage
 * doesn't break the catalog write path. The reserved-fallback in the read
 * path (catalog/routes.public.ts) keeps search functional even with a
 * stale index until the next offline `search:reindex`.
 */

interface CatalogEvents extends Record<string, EventBase> {
  'product.created.v1': EventBase & { productId: string; sku: string };
  'product.updated.v1': EventBase & { productId: string; changedFields: string[] };
  'product.archived.v1': EventBase & { productId: string };
  'attribute.updated.v1': EventBase & {
    key: string;
    isSearchable: boolean;
    isFilterable: boolean;
  };
}

export interface SearchEventSubscriberDeps {
  eventBus: EventBus<CatalogEvents>;
  emFactory: () => EntityManager;
  indexer: SearchIndexer;
  /**
   * Logger hook for failures. Defaults to console.warn so production logs
   * still surface them; tests pass a vi.fn() to assert.
   */
  onError?: (err: unknown, eventName: string) => void;
}

export class SearchEventSubscriber {
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: SearchEventSubscriberDeps) {}

  subscribe(): () => void {
    const { eventBus, emFactory, indexer, onError } = this.deps;
    const log = onError ?? defaultLogger;

    this.unsubscribers.push(
      eventBus.on('product.created.v1', async (payload) => {
        try {
          await indexer.upsertProduct(emFactory(), payload.productId);
        } catch (err) {
          log(err, 'product.created.v1');
        }
      }),
    );
    this.unsubscribers.push(
      eventBus.on('product.updated.v1', async (payload) => {
        try {
          await indexer.upsertProduct(emFactory(), payload.productId);
        } catch (err) {
          log(err, 'product.updated.v1');
        }
      }),
    );
    this.unsubscribers.push(
      eventBus.on('product.archived.v1', async (payload) => {
        try {
          await indexer.deleteProduct(emFactory(), payload.productId);
        } catch (err) {
          log(err, 'product.archived.v1');
        }
      }),
    );
    this.unsubscribers.push(
      eventBus.on('attribute.updated.v1', async () => {
        try {
          await indexer.refreshAttributeSettings(emFactory());
        } catch (err) {
          log(err, 'attribute.updated.v1');
        }
      }),
    );

    return () => this.teardown();
  }

  teardown(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }
}

function defaultLogger(err: unknown, eventName: string): void {
  // eslint-disable-next-line no-console
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'search subscriber handler failed',
      eventName,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}
