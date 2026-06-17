// Search module — feature 006 contract surface.
//
// Public API:
//   - GET  /api/v1/search/suggest           (typeahead popup feed — US1)
//   - POST /api/v1/search/record            (analytics ingest — US3)
//   - POST /api/v1/admin/search/llm/toggle  (LLM-mode toggle wrapper — US2)
//
// Schemas live in three sections, populated by the user-story phases that
// own them. Foundation (T002) seeded the file empty; US1 (T009) adds the
// suggest contracts below. US2 / US3 schemas land later.

import { z } from 'zod';
import { productSummarySchema } from './catalog.js';
import { displayModeSchema } from './price-lists.js';

// ---------------------------------------------------------------------------
// (1) GET /api/v1/search/suggest — US1 / T009
// ---------------------------------------------------------------------------

/**
 * Maximum allowed phrase length, in characters. Mirrors the
 * `phrase varchar(512)` upper bound in `data-model.md §1.1` so the wire
 * contract refuses anything that the storage layer would refuse anyway.
 */
export const SEARCH_PHRASE_MAX_LENGTH = 512;

/**
 * Hard cap on `limit`; the per-channel `search.popup.suggestion_count`
 * setting is what callers normally observe. The cap exists so a misbehaving
 * client cannot ask for more than the popup UX could realistically render.
 */
export const SEARCH_SUGGEST_LIMIT_MAX = 50;

export const SearchSuggestQuerySchema = z.object({
  q: z
    .string()
    .min(1, 'phrase is required')
    .max(SEARCH_PHRASE_MAX_LENGTH, 'phrase exceeds the maximum length'),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(SEARCH_SUGGEST_LIMIT_MAX)
    .optional(),
});
export type SearchSuggestQuery = z.infer<typeof SearchSuggestQuerySchema>;

export const SearchSuggestMetaSchema = z.object({
  /** Effective limit applied to the response. */
  limit: z.number().int().nonnegative(),
  /** The channel's resolved minimum query length, echoed back so the
   *  client can self-correct without a separate round-trip. */
  minimumQueryLength: z.number().int().positive(),
  /** Echo of `q` after trimming, for client-side reconciliation when the
   *  popup is rendering stale state. */
  queryEcho: z.string(),
});
export type SearchSuggestMeta = z.infer<typeof SearchSuggestMetaSchema>;

/**
 * Money carried by an enriched suggestion. The amount is a decimal STRING
 * (e.g. "199.00") to preserve trailing zeros across the wire, matching the
 * `resolved-price` endpoint's shape (feature 011) rather than the foundation
 * `moneySchema` (which uses a number for the legacy `ProductSummary.price`).
 */
export const searchSuggestMoneySchema = z.object({
  amount: z.string(),
  currency: z.string(),
});
export type SearchSuggestMoney = z.infer<typeof searchSuggestMoneySchema>;

/**
 * A typeahead suggestion. Extends the foundation `ProductSummary` (id, sku,
 * name, slug, `primaryAssetUrl`, legacy `price`) with the per-customer
 * price-list resolution so the popup can render the SKU, image, and the
 * price the searching user would actually pay — honouring their price list
 * and price-visibility (`priceDisplayMode`, where `none` hides the price).
 *
 * The pricing fields are optional: when the search module runs without a
 * pricing enricher wired (foundation tests, Meilisearch-only deployments)
 * the response degrades to a plain `ProductSummary` and the storefront
 * falls back to the legacy `price` projection.
 */
export const searchSuggestItemSchema = productSummarySchema.extend({
  /** Resolved price-list Base price for this customer; `null` when no
   *  bracket applies or the price is hidden. */
  basePrice: searchSuggestMoneySchema.nullable().optional(),
  /** Resolved Sale price, when a sale list applies to this customer. */
  salePrice: searchSuggestMoneySchema.nullable().optional(),
  /** Resolved price-visibility mode. `none` ⇒ the storefront must hide the
   *  price and offer a quote affordance instead. */
  priceDisplayMode: displayModeSchema.optional(),
});
export type SearchSuggestItem = z.infer<typeof searchSuggestItemSchema>;

export const SearchSuggestResponseSchema = z.object({
  data: z.array(searchSuggestItemSchema),
  meta: SearchSuggestMetaSchema,
});
export type SearchSuggestResponse = z.infer<typeof SearchSuggestResponseSchema>;

// ---------------------------------------------------------------------------
// (2) POST /api/v1/admin/search/llm/toggle — US2 / T021
// ---------------------------------------------------------------------------

/**
 * The four `search.llm.*` settings whose values are inspected by the
 * toggle wrapper. `enabled` must be present; the other three must be
 * non-empty when `enabled=true`. The wrapper itself only writes the
 * `enabled` setting — the embedder fields are written through the
 * generic Settings admin route and read by the wrapper at validation
 * time.
 */
export const LlmToggleRequestSchema = z.object({
  enabled: z.boolean(),
  /**
   * When omitted, applies to every channel in the setting's scope
   * (parallels SettingsAdminService.setValueForAllChannels). When
   * present, applies only to the listed channels.
   */
  salesChannelCodes: z.array(z.string().min(1)).optional(),
  /**
   * Optimistic-concurrency token from the latest GET of
   * `search.llm.enabled`. When stale, the call rejects with
   * `409 VERSION_CONFLICT` (mirrors Settings' existing model).
   */
  expectedVersion: z.string().nullable().optional(),
});
export type LlmToggleRequest = z.infer<typeof LlmToggleRequestSchema>;

export const LlmToggleResponseSchema = z.object({
  /** Always `search.llm.enabled` — present for parity with the generic Settings route. */
  code: z.literal('search.llm.enabled'),
  enabled: z.boolean(),
  /** New optimistic-concurrency token; the admin UI stores it for the next save. */
  newVersion: z.string(),
  /**
   * Channel UUIDs whose `setting_values` row was written. Mirrors the
   * `affectedChannelIds` SetValueResult shape from feature 004.
   */
  appliedChannelIds: z.array(z.uuid()),
});
export type LlmToggleResponse = z.infer<typeof LlmToggleResponseSchema>;

// ---------------------------------------------------------------------------
// (3) POST /api/v1/search/record — US3 / T030
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget analytics ingest. The storefront's `/search` page
 * fires this on render, AFTER `listProducts` resolves so `resultCount`
 * is meaningful. The endpoint always returns `202 { ok: true }` once
 * the input passes shape validation; persistence failures degrade to a
 * warn log (FR-015 — recording must never delay or fail the search
 * response).
 */
export const RecordPhraseRequestSchema = z.object({
  phrase: z
    .string()
    .min(1)
    .max(SEARCH_PHRASE_MAX_LENGTH),
  /** Result-page count; `0` for dead-end phrases (FR-014). */
  resultCount: z.number().int().nonnegative().optional(),
});
export type RecordPhraseRequest = z.infer<typeof RecordPhraseRequestSchema>;

export const RecordPhraseResponseSchema = z.object({
  ok: z.literal(true),
});
export type RecordPhraseResponse = z.infer<typeof RecordPhraseResponseSchema>;

// ---------------------------------------------------------------------------
// (4) POST /api/v1/admin/search/reindex — manual full Meilisearch reindex
// ---------------------------------------------------------------------------

/**
 * Triggers an immediate, synchronous full reindex of every sales-channel
 * Meilisearch index — the same work the periodic background sweep performs
 * (`search.reindex_interval_minutes`). Body is empty; the response carries a
 * per-run summary so the admin UI can confirm what was rebuilt.
 */
export const SearchReindexResponseSchema = z.object({
  channelsReindexed: z.number().int().nonnegative(),
  documentCount: z.number().int().nonnegative(),
});
export type SearchReindexResponse = z.infer<typeof SearchReindexResponseSchema>;

