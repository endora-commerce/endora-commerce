import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
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
import {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
  type SettingsService,
} from '../../kernel/settings/settings.service.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import { DEFAULT_REINDEX_INTERVAL_MINUTES, SEARCH_SETTING_CODES } from './manifest.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Conditions this module has already reported (D-43's warn-once). Module scope
 * and never reset: an out-of-scope setting is a deployment fact, and the reindex
 * timer would otherwise log it on every tick.
 */
const warnedSearchConditions = new Set<string>();

function warnOnceForSearch(condition: string, message: string): void {
  if (warnedSearchConditions.has(condition)) return;
  warnedSearchConditions.add(condition);
  console.warn(message);
}

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
  /**
   * The cadence the reindex timer reschedules itself on. Exposed because the
   * property worth pinning is "the configured interval is the one used", and a
   * self-rescheduling timer is not a thing a test can ask that of.
   */
  resolveReindexIntervalMinutes: () => Promise<number>;
}

export interface SearchModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: SearchModuleHandle;
}

const numberSchema = z.number();

export function searchModule(options: SearchModuleOptions): SearchModuleResult {
  const indexer = new SearchIndexer({ attributeRead: options.catalogAttributeRead });
  // Handlers only: `backend.ts` registers them through `ctx.subscribe`, which
  // is what makes this module's effective state decide whether they run.
  const subscriber = new SearchEventSubscriber({
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
   *
   * Read **platform-wide** (feature 072, D-41). A background reindex is one
   * timer in one process covering every channel's index, so there is no channel
   * whose value it could sensibly take; it used to pass the literal `'default'`,
   * a channel **code** against a `uuid` column, so PostgreSQL rejected every
   * read, the `catch` answered with the constant, and an operator changing the
   * cadence changed nothing.
   *
   * Absorbs only what D-43 allows; a shape mismatch or a driver error
   * propagates to the caller, which logs it and keeps polling.
   */
  const resolveReindexIntervalMinutes = async (): Promise<number> => {
    try {
      return await options.settingsService.get(
        SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES,
        null,
        z.number().int().nonnegative(),
      );
    } catch (error) {
      if (error instanceof SettingNotRegistered) return DEFAULT_REINDEX_INTERVAL_MINUTES;
      if (error instanceof SettingOutOfScopeForChannel) {
        warnOnceForSearch(
          `out-of-scope:${SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES}`,
          `[search] setting "${SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES}" is scoped ` +
            `to specific sales channels, so it has no platform-wide value — falling back ` +
            `to the manifest default (logged once per process).`,
        );
        return DEFAULT_REINDEX_INTERVAL_MINUTES;
      }
      throw error;
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
      resolveReindexIntervalMinutes,
    },
    plugin: async (app) => {
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
          // Presence is decided here, before any work and outside the `try`s
          // below (issue #126). A timer callback has nowhere to throw to, so
          // `ModuleDisabledError` cannot propagate from it and must be decided;
          // asked from inside one of those `try`s, a switched-off module and a
          // failed sweep would land in the same handler.
          //
          // The reschedule is deliberate and is not a leak: this timer *is* the
          // loop, so returning without re-arming would stop the scheduler for
          // the life of the process and no re-enable would bring it back. It is
          // the same shape as the `minutes <= 0` branch below — keep polling,
          // do nothing.
          if (!effectiveState.isPresent('search')) {
            scheduleNext(DISABLED_POLL_MS);
            return;
          }
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
