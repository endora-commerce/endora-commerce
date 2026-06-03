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
import { SearchPhraseRecorder } from './services/search-phrase-recorder.service.js';
import {
  registerSearchPublicRoutes,
  type SuggestionPricingEnricher,
} from './routes.public.js';
import { registerSearchAdminRoutes } from './routes.admin.js';
import type { RequireAdminFactory } from '../settings/plugin.js';
import type {
  AdminAuditContext,
  SettingsAdminService,
} from '../settings/services/settings-admin.service.js';
import type { SettingsService } from '../settings/services/settings.service.js';
import { SalesChannel } from '../sales_channels/entities/sales-channel.entity.js';
import { SEARCH_SETTING_CODES } from './manifest.js';

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
   * Universal-getter for Settings. When provided, the suggest service
   * resolves its per-channel popup-count + minimum-query-length from
   * Settings, and the event subscriber attaches the `settings.value_changed`
   * → embedder reactor. When absent, the module runs with manifest-time
   * defaults and no LLM reactor — useful for foundation tests that
   * predate Settings.
   */
  settingsService?: SettingsService;
  /**
   * Admin Settings service — required when admin routes are mounted.
   * Drives the `LlmToggleService.toggle` write path. Without it, only
   * the public routes register.
   */
  settingsAdminService?: SettingsAdminService;
  /** When provided, admin routes mount under `/api/v1/admin/search/*`. */
  requireAdmin?: RequireAdminFactory;
  resolveAdminAuditContext?: (req: FastifyRequest) => AdminAuditContext;
  /**
   * When provided, typeahead suggestions are enriched with the per-customer
   * price-list resolution (SKU + image already ride on the summary). Wired
   * from the composition root where the price-lists `PricingService` lives.
   */
  enrichSuggestionPricing?: SuggestionPricingEnricher;
}

export interface SearchModuleHandle {
  indexer: SearchIndexer;
  subscriber: SearchEventSubscriber;
  searchQueryService: SearchQueryService;
  suggestService: SearchSuggestService;
  llmToggleService?: LlmToggleService;
  phraseRecorder: SearchPhraseRecorder;
}

export interface SearchModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: SearchModuleHandle;
}

const numberSchema = z.number();

export function searchModule(options: SearchModuleOptions): SearchModuleResult {
  const indexer = new SearchIndexer();
  const subscriber = new SearchEventSubscriber({
    eventBus: options.eventBus as never,
    emFactory: options.emFactory,
    indexer,
    ...(options.settingsService !== undefined
      ? { settingsService: options.settingsService }
      : {}),
  });
  const searchQueryService = new SearchQueryService(options.emFactory);

  // Settings-aware suggest config, with fallback to manifest defaults
  // when the resolver fails for any reason (e.g. Redis hiccup,
  // `SettingNotRegistered`). The popup must never 500 because of a
  // Settings glitch.
  const resolveSuggestConfig = options.settingsService
    ? async (ctx: { salesChannelCode?: string | undefined }): Promise<SuggestionCountConfig> => {
        const fallback: SuggestionCountConfig = {
          defaultLimit: DEFAULT_SUGGESTION_COUNT,
          minimumQueryLength: DEFAULT_MINIMUM_QUERY_LENGTH,
        };
        try {
          const em = options.emFactory();
          const channel = ctx.salesChannelCode
            ? await em.findOne(SalesChannel, { code: ctx.salesChannelCode })
            : await em.findOne(SalesChannel, { isPublic: true });
          if (!channel) return fallback;
          const [defaultLimit, minimumQueryLength] = await Promise.all([
            options.settingsService!.get(
              SEARCH_SETTING_CODES.POPUP_SUGGESTION_COUNT,
              channel.id,
              numberSchema,
            ),
            options.settingsService!.get(
              SEARCH_SETTING_CODES.POPUP_MINIMUM_QUERY_LENGTH,
              channel.id,
              numberSchema,
            ),
          ]);
          return { defaultLimit, minimumQueryLength };
        } catch {
          return fallback;
        }
      }
    : undefined;

  const suggestService = resolveSuggestConfig
    ? new SearchSuggestService(searchQueryService, resolveSuggestConfig)
    : new SearchSuggestService(searchQueryService);

  const llmToggleService =
    options.settingsService && options.settingsAdminService
      ? new LlmToggleService(
          options.emFactory,
          options.settingsService,
          options.settingsAdminService,
        )
      : undefined;

  const phraseRecorder = new SearchPhraseRecorder(
    options.emFactory,
    options.settingsService,
  );

  return {
    handle: {
      indexer,
      subscriber,
      searchQueryService,
      suggestService,
      phraseRecorder,
      ...(llmToggleService !== undefined ? { llmToggleService } : {}),
    },
    plugin: async (app) => {
      const teardown = subscriber.subscribe();
      app.addHook('onClose', async () => teardown());
      // US1 — typeahead popup feed.
      // US3 — analytics ingest. Both live in routes.public.ts.
      await registerSearchPublicRoutes(app, {
        suggestService,
        phraseRecorder,
        ...(options.enrichSuggestionPricing !== undefined
          ? { enrichSuggestionPricing: options.enrichSuggestionPricing }
          : {}),
      });
      // US2 — LLM toggle wrapper. Mounts only when the admin gate +
      // settings admin service are both wired (test-server passes them).
      if (llmToggleService && options.requireAdmin) {
        await registerSearchAdminRoutes(app, {
          llmToggleService,
          requireAdmin: options.requireAdmin,
          ...(options.resolveAdminAuditContext !== undefined
            ? { resolveAdminAuditContext: options.resolveAdminAuditContext }
            : {}),
        });
      }
    },
  };
}
