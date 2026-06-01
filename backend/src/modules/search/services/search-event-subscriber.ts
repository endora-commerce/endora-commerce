import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBase, EventBus } from '../../../events/bus.js';
import type { SearchIndexer } from './search-indexer.js';
import type { SettingsService } from '../../settings/services/settings.service.js';
import { z } from 'zod';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { SEARCH_SETTING_CODES } from '../manifest.js';

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
 *   - `product.deleted.v1`  → deleteProduct
 *   - `attribute.updated.v1` → refreshAttributeSettings
 *
 * Feature 006 / T027 also attaches the LLM-augmented-search reactor:
 *
 *   - `settings.value_changed` (settingCode = `search.llm.enabled`)
 *      → attach or detach a Meilisearch embedder per affected channel,
 *        depending on the new boolean value. When `enabled=true` and any
 *        of the embedder.* config values are empty, the handler logs and
 *        no-ops — the toggle's pre-write validator (LlmToggleService) is
 *        the user-visible refusal path; this handler is the
 *        belt-and-braces guard for direct generic-Settings writes.
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
  'product.deleted.v1': EventBase & { productId: string };
  'attribute.updated.v1': EventBase & {
    key: string;
    isSearchable: boolean;
    isFilterable: boolean;
  };
  'settings.value_changed': EventBase & {
    settingCode: string;
    salesChannelIds: string[];
    /**
     * Set when the platform-wide global override (settings.global_value)
     * changed (feature 042). Channels without a per-channel override
     * resolve from the global; this flag tells the reactor to re-evaluate
     * every in-scope channel, not only the codes listed in `salesChannelIds`.
     */
    globalValueUpdated?: boolean;
    valueType: string;
  };
}

export interface SearchEventSubscriberDeps {
  eventBus: EventBus<CatalogEvents>;
  emFactory: () => EntityManager;
  indexer: SearchIndexer;
  /**
   * Universal-getter for Settings — required when the LLM-toggle reactor
   * is enabled (feature 006). When undefined, the `settings.value_changed`
   * handler is not attached; foundation tests that don't have settings
   * wired stay green.
   */
  settingsService?: SettingsService;
  /**
   * Logger hook for failures. Defaults to console.warn so production logs
   * still surface them; tests pass a vi.fn() to assert.
   */
  onError?: (err: unknown, eventName: string) => void;
}

const booleanSchema = z.boolean();
const stringSchema = z.string();

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
      eventBus.on('product.deleted.v1', async (payload) => {
        try {
          await indexer.deleteProduct(emFactory(), payload.productId);
        } catch (err) {
          log(err, 'product.deleted.v1');
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

    if (this.deps.settingsService) {
      const settingsService = this.deps.settingsService;
      this.unsubscribers.push(
        eventBus.on('settings.value_changed', async (payload) => {
          if (payload.settingCode !== SEARCH_SETTING_CODES.LLM_ENABLED) return;
          try {
            const em = emFactory();
            // Feature 042: a global-override change touches every channel
            // that doesn't carry its own per-channel value — re-evaluate
            // the lot. Per-channel writes still target only the listed ids.
            const channels = payload.globalValueUpdated
              ? await em.find(SalesChannel, {})
              : await em.find(SalesChannel, {
                  id: { $in: payload.salesChannelIds },
                });
            for (const channel of channels) {
              const enabled = await settingsService.get(
                SEARCH_SETTING_CODES.LLM_ENABLED,
                channel.id,
                booleanSchema,
              );
              if (enabled) {
                const [url, apiKey, model] = await Promise.all([
                  settingsService.get(
                    SEARCH_SETTING_CODES.LLM_EMBEDDER_URL,
                    channel.id,
                    stringSchema,
                  ),
                  settingsService.get(
                    SEARCH_SETTING_CODES.LLM_EMBEDDER_API_KEY,
                    channel.id,
                    stringSchema,
                  ),
                  settingsService.get(
                    SEARCH_SETTING_CODES.LLM_EMBEDDER_MODEL,
                    channel.id,
                    stringSchema,
                  ),
                ]);
                if (url && apiKey && model) {
                  await indexer.attachEmbedderForChannel(channel.code, {
                    url,
                    apiKey,
                    model,
                  });
                } else {
                  // Direct generic-Settings write bypassed the toggle
                  // validator; surface for ops, leave the index alone so
                  // we don't poison Meilisearch with empty creds.
                  log(
                    new Error(
                      `LLM enabled on channel ${channel.code} without complete embedder config; embedder NOT attached`,
                    ),
                    'settings.value_changed',
                  );
                }
              } else {
                await indexer.detachEmbedderForChannel(channel.code);
              }
            }
          } catch (err) {
            log(err, 'settings.value_changed');
          }
        }),
      );
    }

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
