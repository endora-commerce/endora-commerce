import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBase } from '@endora-commerce/platform/events';
import type { SearchIndexer } from './search-indexer.js';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { z } from 'zod';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { SEARCH_SETTING_CODES } from '../../manifest.js';
import {
  resolveEmbedderConfig,
  type CredentialResolvePort,
} from './embedder-config-resolver.js';

/**
 * SearchEventSubscriber (T067 — incremental upsert path).
 *
 * The handlers that keep the per-channel Meilisearch indexes in sync with
 * Postgres, so a catalog mutation costs an incremental upsert rather than an
 * offline reindex. **The class no longer subscribes to anything** — the
 * registrations live in this module's `backend.ts`, where `ctx.subscribe` wraps
 * each one in `subscribeForModule` and the module's effective state decides
 * whether the handler runs (issue #107). What used to happen here was a bare
 * `eventBus.on`, so a deployment with `search` switched off went on rewriting
 * Meilisearch documents on every product write.
 *
 * The events `backend.ts` maps onto these methods:
 *
 *   - `product.created.v1`  → upsertProduct
 *   - `product.updated.v1`  → upsertProduct
 *   - `product.archived.v1` → deleteProduct
 *   - `product.deleted.v1`  → deleteProduct
 *   - `attribute.updated.v1` → refreshAttributeSettings
 *   - `category.updated.v1` → reindexCategorySubtree (feature 068: the
 *      category's slug and activation state are projected onto every product
 *      document under it, so a rename or a deactivation has to reach the index)
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
  'category.updated.v1': EventBase & { categoryId: string };
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

/** The `settings.value_changed` payload this module reacts to. */
export type SettingChangedPayload = CatalogEvents['settings.value_changed'];

export interface SearchEventSubscriberDeps {
  emFactory: () => EntityManager;
  indexer: SearchIndexer;
  /**
   * Universal-getter for Settings — required when the LLM-toggle reactor
   * is enabled (feature 006). When undefined, the `settings.value_changed`
   * handler is not attached; foundation tests that don't have settings
   * wired stay green.
   */
  settingsService?: SettingsReadPort;
  /**
   * Feature 058 — resolves `search.llm.embedder_credentials` into the embedder
   * config, falling back per field to the legacy embedder settings. Optional.
   */
  credentials?: CredentialResolvePort;
  /**
   * Logger hook for failures. Defaults to console.warn so production logs
   * still surface them; tests pass a vi.fn() to assert.
   */
  onError?: (err: unknown, eventName: string) => void;
}

const booleanSchema = z.boolean();

export class SearchEventSubscriber {
  constructor(private readonly deps: SearchEventSubscriberDeps) {}

  private get log(): NonNullable<SearchEventSubscriberDeps['onError']> {
    return this.deps.onError ?? defaultLogger;
  }

  /** `product.created.v1` / `product.updated.v1`. */
  async onProductUpserted(productId: string, eventName: string): Promise<void> {
    try {
      await this.deps.indexer.upsertProduct(this.deps.emFactory(), productId);
    } catch (err) {
      this.log(err, eventName);
    }
  }

  /** `product.archived.v1` / `product.deleted.v1`. */
  async onProductRemoved(productId: string, eventName: string): Promise<void> {
    try {
      await this.deps.indexer.deleteProduct(this.deps.emFactory(), productId);
    } catch (err) {
      this.log(err, eventName);
    }
  }

  /**
   * `category.updated.v1` — feature 068: a category's slug and activation state
   * are projected onto every product document beneath it.
   */
  async onCategoryUpdated(categoryId: string): Promise<void> {
    try {
      await this.deps.indexer.reindexCategorySubtree(this.deps.emFactory(), categoryId);
    } catch (err) {
      this.log(err, 'category.updated.v1');
    }
  }

  /** `attribute.updated.v1`. */
  async onAttributeUpdated(): Promise<void> {
    try {
      await this.deps.indexer.refreshAttributeSettings(this.deps.emFactory());
    } catch (err) {
      this.log(err, 'attribute.updated.v1');
    }
  }

  /**
   * `settings.value_changed` — the LLM-augmented-search reactor (feature 006 /
   * T027). A no-op unless a settings service was supplied.
   */
  async onSettingChanged(payload: SettingChangedPayload): Promise<void> {
    const settingsService = this.deps.settingsService;
    if (!settingsService) return;
    if (payload.settingCode !== SEARCH_SETTING_CODES.LLM_ENABLED) return;
    const { emFactory, indexer } = this.deps;
    const log = this.log;
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
          // Feature 058 — prefer the credential reference, fall back per
          // field to the legacy embedder settings.
          const { url, apiKey, model } = await resolveEmbedderConfig(
            settingsService,
            channel.id,
            this.deps.credentials,
          );
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
  }
}

function defaultLogger(err: unknown, eventName: string): void {
   
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'search subscriber handler failed',
      eventName,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}
