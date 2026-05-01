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
