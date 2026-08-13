import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import { z } from 'zod';
import { SearchIndexer } from './services/search-indexer.js';
import { SearchEventSubscriber } from './services/search-event-subscriber.js';
import { SearchQueryService } from './services/search-query.service.js';
import {
  SearchSuggestService,
  type SuggestionCountConfig,
  DEFAULT_SUGGESTION_COUNT,
  DEFAULT_MINIMUM_QUERY_LENGTH,
} from './services/search-suggest.service.js';
import { LlmToggleService } from './services/llm-toggle.service.js';
import type { CredentialResolvePort } from './services/embedder-config-resolver.js';
import { SearchReindexWorker } from './services/search-reindex-worker.js';
import { SearchPhraseRecorder } from './services/search-phrase-recorder.service.js';
import {
  registerSearchPublicRoutes,
  type SuggestionPricingEnricher,
} from './routes.public.js';
import { registerSearchAdminRoutes } from './routes.admin.js';
import type { CatalogAttributeReadService } from '../catalog/services/catalog-attribute-read.service.js';
import type {
  AdminAuditContext,
  SettingsAdminService,
} from '../settings/services/settings-admin.service.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { DEFAULT_REINDEX_INTERVAL_MINUTES, SEARCH_SETTING_CODES } from './manifest.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Composition root for the search module — feature 006.
 *
 * Owns lifecycle for:
 *   - {@link SearchIndexer} — per-channel Meilisearch indexer (foundation 001).
 *   - {@link SearchEventSubscriber} — bridges catalog events + the
 *     `settings.value_changed` reactor (US2) so the per-channel Meilisearch
 *     indexes track Postgres mutations + LLM-mode flips automatically.
 *   - {@link SearchSuggestService} — typeahead popup adapter on top of
 *     {@link SearchQueryService}; reads its per-channel limit and
 *     threshold from Settings when wired (US2).
 *   - {@link LlmToggleService} — cross-setting validating wrapper around
 *     `search.llm.enabled` (US2).
 *
 * Module isolation (Constitution I): catalog publishes
 * `product.*`/`attribute.*` events. Settings publishes
 * `settings.value_changed`. Search subscribes here. Removing this module
 * leaves catalog and settings working — there are no dangling references.
 */

export interface SearchModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  /**
   * Feature 061 — the catalog's composed attribute read model (Principle I).
   * Backs the indexer's searchable/filterable settings + option-label
   * aggregation and the query service's filterable validation.
   */
  catalogAttributeRead: CatalogAttributeReadService;
  /**
   * Universal-getter for Settings. Backs the suggest service's per-channel
   * popup-count + minimum-query-length, the `settings.value_changed` →
   * embedder reactor, and the reindex interval.
   *
   * Required since feature 072 (T123). It was optional for "foundation tests
   * that predate Settings", and no such caller was left: both composition
   * roots passed it, and absence silently downgraded the module to manifest
   * defaults with no LLM reactor — a state nothing asked for and nothing
   * detected.
   */
  settingsService: SettingsService;
  /**
   * Feature 058 — resolves the `search.llm.embedder_credentials` reference into
   * the embedder config, falling back per field to the legacy embedder settings.
   * Injected as a narrow port (Principle I).
   */
  credentials: CredentialResolvePort;
  /** Admin Settings service — drives the `LlmToggleService.toggle` write path. */
  settingsAdminService: SettingsAdminService;
  /** Admin routes mount under `/api/v1/admin/search/*`. */
  requireAdmin: RequireAdminFactory;
  resolveAdminAuditContext: (req: FastifyRequest) => AdminAuditContext;
  /**
   * Typeahead suggestions carry the per-customer price-list resolution (SKU +
   * image already ride on the summary), so the popup shows the price the
   * searching user would actually pay.
   */
  enrichSuggestionPricing: SuggestionPricingEnricher;
  /**
   * When `true`, the module starts the periodic full-reindex sweep. The
   * composition passes its deployment-role gate (`runWorkers`) here so the
   * sweep only runs in worker/all processes, never in a dedicated
   * `BACKEND_ROLE=api` process — and never in a test harness.
   */
  enableReindexScheduler: boolean;
}

export interface SearchModuleHandle {
  indexer: SearchIndexer;
  subscriber: SearchEventSubscriber;
  searchQueryService: SearchQueryService;
  suggestService: SearchSuggestService;
  llmToggleService: LlmToggleService;
  reindexWorker: SearchReindexWorker;
  phraseRecorder: SearchPhraseRecorder;
}

export interface SearchModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: SearchModuleHandle;
}

const numberSchema = z.number();

export function searchModule(options: SearchModuleOptions): SearchModuleResult {
  const indexer = new SearchIndexer({ attributeRead: options.catalogAttributeRead });
  const subscriber = new SearchEventSubscriber({
    eventBus: options.eventBus as never,
    emFactory: options.emFactory,
    indexer,
    ...(options.settingsService !== undefined
      ? { settingsService: options.settingsService }
      : {}),
    ...(options.credentials !== undefined ? { credentials: options.credentials } : {}),
  });
  const searchQueryService = new SearchQueryService(
    options.emFactory,
    options.catalogAttributeRead,
  );

  // Settings-aware suggest config, with fallback to manifest defaults
  // when the resolver fails for any reason (e.g. Redis hiccup,
  // `SettingNotRegistered`). The popup must never 500 because of a
  // Settings glitch.
  const resolveSuggestConfig = async (ctx: {
        resolvedChannel: { id: string };
      }): Promise<SuggestionCountConfig> => {
        const fallback: SuggestionCountConfig = {
          defaultLimit: DEFAULT_SUGGESTION_COUNT,
          minimumQueryLength: DEFAULT_MINIMUM_QUERY_LENGTH,
        };
        try {
          // Feature 053 / FR-002: per-channel settings key off the channel
          // resolved once upstream — no re-resolution here.
          const channelId = ctx.resolvedChannel.id;
          const [defaultLimit, minimumQueryLength] = await Promise.all([
            options.settingsService.get(
              SEARCH_SETTING_CODES.POPUP_SUGGESTION_COUNT,
              channelId,
              numberSchema,
            ),
            options.settingsService.get(
              SEARCH_SETTING_CODES.POPUP_MINIMUM_QUERY_LENGTH,
              channelId,
              numberSchema,
            ),
          ]);
          return { defaultLimit, minimumQueryLength };
        } catch {
          return fallback;
        }
      };

  const suggestService = new SearchSuggestService(searchQueryService, resolveSuggestConfig);

  const llmToggleService = new LlmToggleService(
    options.emFactory,
    options.settingsService,
    options.settingsAdminService,
    options.credentials,
  );

  /**
   * The sweep's cadence is this module's own setting, so it reads it itself
   * rather than taking a resolver from a composition root — which is where the
   * identical `try`/`catch`-to-the-manifest-default lived before T123.
   */
  const resolveReindexIntervalMinutes = async (): Promise<number> => {
    try {
      return await options.settingsService.get(
        SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES,
        'default',
        z.number().int().nonnegative(),
      );
    } catch {
      return DEFAULT_REINDEX_INTERVAL_MINUTES;
    }
  };

  const phraseRecorder = new SearchPhraseRecorder(
    options.emFactory,
    options.settingsService,
  );

  const reindexWorker = new SearchReindexWorker({
    emFactory: options.emFactory,
    indexer,
  });

  return {
    handle: {
      indexer,
      subscriber,
      searchQueryService,
      suggestService,
      reindexWorker,
      phraseRecorder,
      llmToggleService,
    },
    plugin: async (app) => {
      const teardown = subscriber.subscribe();
      app.addHook('onClose', async () => teardown());
      // US1 — typeahead popup feed.
      // US3 — analytics ingest. Both live in routes.public.ts.
      await registerSearchPublicRoutes(app, {
        suggestService,
        phraseRecorder,
        enrichSuggestionPricing: options.enrichSuggestionPricing,
      });
      // US2 — LLM toggle wrapper. Mounts only when the admin gate +
      // settings admin service are both wired (test-server passes them).
      await registerSearchAdminRoutes(app, {
        llmToggleService,
        reindexWorker,
        requireAdmin: options.requireAdmin,
        resolveAdminAuditContext: options.resolveAdminAuditContext,
      });

      // Periodic full Meilisearch reindex (FR — keep the catalogue in sync
      // even when an incremental event was missed). The interval is read
      // from Settings on every tick via a self-rescheduling timer, so an
      // operator changing `search.reindex_interval_minutes` takes effect on
      // the next cycle without a restart. A value <= 0 disables the sweep but
      // the timer keeps polling the setting so it can be re-enabled live.
      if (options.enableReindexScheduler) {
        const DISABLED_POLL_MS = 60_000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;

        const scheduleNext = (delayMs: number): void => {
          if (stopped) return;
          timer = setTimeout(tick, delayMs);
          if (typeof timer.unref === 'function') timer.unref();
        };

        const tick = (): void => {
          void (async () => {
            let minutes = 0;
            try {
              minutes = await resolveReindexIntervalMinutes();
            } catch (err) {
              app.log.error({ err }, 'search reindex: failed to resolve interval setting');
            }
            if (Number.isFinite(minutes) && minutes > 0) {
              try {
                const result = await reindexWorker.reindex();
                app.log.info({ result }, 'search reindex sweep completed');
              } catch (err) {
                app.log.error({ err }, 'search reindex sweep failed');
              }
              scheduleNext(minutes * 60_000);
            } else {
              // Disabled — keep polling so a re-enable takes effect live.
              scheduleNext(DISABLED_POLL_MS);
            }
          })();
        };

        // Kick off the first poll without an immediate reindex at boot.
        scheduleNext(DISABLED_POLL_MS);
        app.addHook('onClose', async () => {
          stopped = true;
          if (timer) clearTimeout(timer);
        });
      }
    },
  };
}
