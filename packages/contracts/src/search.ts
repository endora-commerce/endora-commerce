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
import { productSummarySchema, type ProductSummary } from './catalog.js';
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

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `search` publishes to the one module that reads it
// (feature 075, Phase P): `catalog`'s public product listing hands the query
// over when `CATALOG_SEARCH_BACKEND=meilisearch`, and serves it from Postgres
// otherwise.
// ---------------------------------------------------------------------------

/** The channel a search runs in, resolved before the query is built. */
export interface ResolvedSearchChannel {
  id: string;
  code: string;
  isPublic: boolean;
  defaultCurrency: string;
  defaultLanguage: string;
}

export interface SearchQueryContext {
  resolvedChannel: ResolvedSearchChannel;
  preferredLanguage?: string | undefined;
}

export interface SearchListProductsParams {
  q?: string | undefined;
  limit: number;
  cursor?: string | undefined;
  sort?: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]> | undefined;
}

export interface SearchListResult {
  data: ProductSummary[];
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

/**
 * What a listing query answered: the page, or the fact that the index could
 * not be reached.
 *
 * The second arm exists so the caller does not have to write a `catch` to
 * learn it. `search` raises `SearchBackendUnavailable` internally when
 * Meilisearch is unreachable; the port converts it here, on the owner's side,
 * because a consumer catching it would be a `catch` around a port call — and
 * that `catch` would swallow `ModuleDisabledError` too, turning "the operator
 * switched `search` off" into "the index is slow today". Two different facts
 * with two different right answers, fused by one `catch` clause.
 *
 * This is the `allowedIdsFor(): Promise<string[] | null>` shape AGENTS.md names
 * as the worked example: where a degrade genuinely belongs, it goes inside the
 * owner's implementation and is expressed in the return type.
 */
export type SearchListOutcome =
  | { status: 'ok'; result: SearchListResult }
  /** Meilisearch refused or timed out. `reason` is for the caller's log line. */
  | { status: 'index-unavailable'; reason: string };

/**
 * Container name: `searchQueryPort`. Owner: `search`.
 *
 * **The one port in the sweep whose consumer is right to degrade rather than
 * fail**, and the degrade is already where it belongs: `catalog`'s listing
 * route checks the backend setting and falls back to its own Postgres query.
 * That is a `nonBindingDependencies` edge, declared, not a `catch` — a search
 * index being unavailable must not take the catalogue down with it.
 *
 * Note what the fallback is *not* allowed to be: a `try`/`catch` around the
 * call. Catching here would swallow `ModuleDisabledError` and make a
 * switched-off `search` look like a slow one, which is the fail-open shape
 * `check:port-catches` exists for. That is why `listProducts` answers a
 * {@link SearchListOutcome} rather than throwing: the consumer distinguishes
 * the two states by reading a field, and never by catching.
 */
export interface SearchQueryPort {
  listProducts(
    params: SearchListProductsParams,
    ctx: SearchQueryContext,
  ): Promise<SearchListOutcome>;
}

