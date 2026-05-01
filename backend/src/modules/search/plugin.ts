import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { SearchIndexer } from './services/search-indexer.js';
import { SearchEventSubscriber } from './services/search-event-subscriber.js';
import { SearchQueryService } from './services/search-query.service.js';
import { SearchSuggestService } from './services/search-suggest.service.js';
import { registerSearchPublicRoutes } from './routes.public.js';

/**
 * Composition root for the search module — feature 006 / T004.
 *
 * Owns lifecycle for:
 *   - {@link SearchIndexer} — per-channel Meilisearch indexer (foundation 001).
 *   - {@link SearchEventSubscriber} — bridges catalog events to the indexer
 *     so the per-channel Meilisearch indexes track Postgres mutations
 *     incrementally (R-3: subscriber wiring lives here, not in catalog).
 *
 * Module isolation (Constitution I): catalog publishes
 * `product.created.v1`, `product.updated.v1`, `product.archived.v1`,
 * `attribute.updated.v1`. Search subscribes here. Removing this module
 * leaves catalog working — there are no dangling references.
 *
 * Public routes (`/api/v1/search/*`) and admin routes
 * (`/api/v1/admin/search/*`) are registered by the user-story phases
 * that own them (US1 → suggest, US2 → llm-toggle, US3 → record).
 */

export interface SearchModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
}

export interface SearchModuleHandle {
  indexer: SearchIndexer;
  subscriber: SearchEventSubscriber;
  searchQueryService: SearchQueryService;
  suggestService: SearchSuggestService;
}

export interface SearchModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: SearchModuleHandle;
}

export function searchModule(options: SearchModuleOptions): SearchModuleResult {
  const indexer = new SearchIndexer();
  const subscriber = new SearchEventSubscriber({
    eventBus: options.eventBus as never,
    emFactory: options.emFactory,
    indexer,
  });
  const searchQueryService = new SearchQueryService(options.emFactory);
  const suggestService = new SearchSuggestService(searchQueryService);

  return {
    handle: { indexer, subscriber, searchQueryService, suggestService },
    plugin: async (app) => {
      const teardown = subscriber.subscribe();
      app.addHook('onClose', async () => teardown());
      // US1 — typeahead popup feed.
      await registerSearchPublicRoutes(app, { suggestService });
      // US2 admin routes (T028) and US3 record route (T037) wire here later.
    },
  };
}
