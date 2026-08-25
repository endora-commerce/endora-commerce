import type { EntityManager } from '@mikro-orm/postgresql';
import type { SearchIndexer } from './search-indexer.js';

/**
 * SearchReindexWorker — periodic full Meilisearch reindex.
 *
 * Wraps {@link SearchIndexer.reindexAllChannels} so the catalogue stays in
 * sync even when an incremental event was missed (e.g. a bulk import that
 * bypassed the catalog event bus, or a Meilisearch restart). The sweep runs
 * every `search.reindex_interval_minutes` minutes (Settings, default 10); the
 * same `reindex()` entry point also backs the admin "Reindex now" button.
 *
 * Public `reindex()` is a plain async function so tests can drive it directly
 * without Redis/BullMQ and so the admin route can call it synchronously.
 */
export interface SearchReindexWorkerDeps {
  emFactory: () => EntityManager;
  indexer: SearchIndexer;
}

export class SearchReindexWorker {
  constructor(private readonly deps: SearchReindexWorkerDeps) {}

  async reindex(): Promise<{ channelsReindexed: number; documentCount: number }> {
    const em = this.deps.emFactory();
    const results = await this.deps.indexer.reindexAllChannels(em);
    const documentCount = results.reduce((sum, r) => sum + r.documentCount, 0);
    return { channelsReindexed: results.length, documentCount };
  }
}
