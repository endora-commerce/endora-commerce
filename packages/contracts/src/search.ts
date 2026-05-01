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

export const SearchSuggestResponseSchema = z.object({
  data: z.array(productSummarySchema),
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

