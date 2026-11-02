import { z } from 'zod';
import { uuidSchema } from './common.js';

// Saved list views — the shapes every admin list's saved-view endpoints share
// (orders, products, quote requests, returns, tasks). Orders keeps its own exported names in
// `orders.ts`, built on these.

export const SAVED_LIST_VIEW_NAME_MAX = 160;
/** UTF-8 bytes of `JSON.stringify(filters)`. */
export const SAVED_LIST_VIEW_FILTERS_MAX_BYTES = 8192;
/** Entries in `visibleColumns`. */
export const SAVED_LIST_VIEW_COLUMNS_MAX = 64;
/** Characters per column id and per `sort.field`. */
export const SAVED_LIST_VIEW_TOKEN_MAX = 64;

const FORBIDDEN_NAME_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

/** Control (Cc) and format (Cf) characters — NUL, bidi overrides, zero-width characters. */
export function hasForbiddenNameCharacters(name: string): boolean {
  return FORBIDDEN_NAME_CHARACTERS.test(name);
}

/**
 * UTF-8 length of a string, counted per code point. Hand-rolled rather than
 * `Buffer.byteLength` or `TextEncoder`: this package is browser-safe and
 * compiles against the ES2022 library alone, which declares neither. A lone
 * surrogate counts as 3 bytes, as its U+FFFD replacement would encode.
 */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Trimmed, 1–160 characters, no control or format characters. Every create and update schema uses it. */
export const savedListViewNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(SAVED_LIST_VIEW_NAME_MAX)
  .refine((name) => !hasForbiddenNameCharacters(name), {
    message: 'Name must not contain control or format characters',
  });

export const savedListViewSortSchema = z.object({
  field: z.string().min(1).max(SAVED_LIST_VIEW_TOKEN_MAX),
  dir: z.enum(['asc', 'desc']),
});
export type SavedListViewSort = z.infer<typeof savedListViewSortSchema>;

/** Opaque to the server, but bounded in size. */
export const savedListViewFiltersSchema = z.record(z.string(), z.unknown()).refine(
  (filters) => {
    let json: string;
    try {
      json = JSON.stringify(filters);
    } catch {
      return false;
    }
    return utf8ByteLength(json) <= SAVED_LIST_VIEW_FILTERS_MAX_BYTES;
  },
  { message: `Filters must not exceed ${SAVED_LIST_VIEW_FILTERS_MAX_BYTES} bytes` },
);

export const savedListViewColumnsSchema = z
  .array(z.string().min(1).max(SAVED_LIST_VIEW_TOKEN_MAX))
  .max(SAVED_LIST_VIEW_COLUMNS_MAX);

/** One list item, as every list's GET returns it. */
export const savedListViewSchema = z.object({
  id: uuidSchema,
  /** As stored — a legacy order row may exceed today's write rule. */
  name: z.string(),
  shared: z.boolean(),
  ownerAdminUserId: uuidSchema,
  ownedByCaller: z.boolean(),
  /** `ownedByCaller`, or a shared view and the caller is a platform admin. */
  canModify: z.boolean(),
  filters: z.record(z.string(), z.unknown()),
  sort: savedListViewSortSchema.nullable().optional(),
  /** Column-picker selection. `null` ⇒ fall back to the default-visible set. */
  visibleColumns: z.array(z.string()).nullable().optional(),
});
export type SavedListView = z.infer<typeof savedListViewSchema>;

export const savedListViewListResponseSchema = z.object({ data: z.array(savedListViewSchema) });
export type SavedListViewListResponse = z.infer<typeof savedListViewListResponseSchema>;

export const savedListViewResponseSchema = z.object({ data: savedListViewSchema });
export type SavedListViewResponse = z.infer<typeof savedListViewResponseSchema>;

export const savedListViewDeleteResponseSchema = z.object({
  data: z.object({ deleted: uuidSchema }),
});
export type SavedListViewDeleteResponse = z.infer<typeof savedListViewDeleteResponseSchema>;

/**
 * The key two names are compared by for uniqueness, as the client computes it
 * for a **best-effort pre-check** before saving. The server's SQL
 * `lower(btrim(name))` is authoritative and refuses a taken key with 409 on
 * its own: the client checks only the views it has listed, and JavaScript's
 * `trim`/`toLowerCase` and PostgreSQL's `btrim`/`lower` need not agree on
 * every character.
 * `toLowerCase`, not `toLocaleLowerCase`: the key must not follow the browser's
 * locale (Turkish lower-cases `I` to `ı`), or client and server disagree.
 */
export function savedListViewNameKey(name: string): string {
  return name.trim().toLowerCase();
}

// --- Products: filters only (the product list has no sort and no column picker)

export const createProductSavedViewRequestSchema = z.object({
  name: savedListViewNameSchema,
  shared: z.boolean(),
  filters: savedListViewFiltersSchema,
});
export type CreateProductSavedViewRequest = z.infer<typeof createProductSavedViewRequestSchema>;

export const updateProductSavedViewRequestSchema = createProductSavedViewRequestSchema.partial();
export type UpdateProductSavedViewRequest = z.infer<typeof updateProductSavedViewRequestSchema>;

// --- Quote requests: filters, sort and column selection ---------------------

export const createQuoteRequestSavedViewRequestSchema = z.object({
  name: savedListViewNameSchema,
  shared: z.boolean(),
  filters: savedListViewFiltersSchema,
  sort: savedListViewSortSchema.nullable().optional(),
  visibleColumns: savedListViewColumnsSchema.nullable().optional(),
});
export type CreateQuoteRequestSavedViewRequest = z.infer<
  typeof createQuoteRequestSavedViewRequestSchema
>;

export const updateQuoteRequestSavedViewRequestSchema =
  createQuoteRequestSavedViewRequestSchema.partial();
export type UpdateQuoteRequestSavedViewRequest = z.infer<
  typeof updateQuoteRequestSavedViewRequestSchema
>;

// --- Tasks: filters, sort and column selection (`specs/165-task-management/` R-13)
//
// One view serves the list and the board: the board applies its filters and
// ignores its sort. A saved value that no longer exists (a tag, a status, a
// person) is dropped on apply; the list never answers 422 for it.

export const createTaskSavedViewRequestSchema = z.object({
  name: savedListViewNameSchema,
  shared: z.boolean(),
  filters: savedListViewFiltersSchema,
  sort: savedListViewSortSchema.nullable().optional(),
  visibleColumns: savedListViewColumnsSchema.nullable().optional(),
});
export type CreateTaskSavedViewRequest = z.infer<typeof createTaskSavedViewRequestSchema>;

export const updateTaskSavedViewRequestSchema = createTaskSavedViewRequestSchema.partial();
export type UpdateTaskSavedViewRequest = z.infer<typeof updateTaskSavedViewRequestSchema>;

// --- Returns: filters, sort and column selection (#312)
//
// The return list's table predates these rules, so like the order list's its
// views always carry a sort, and rows saved before them keep their names as
// stored (see `savedListViewSchema.name`).

export const createReturnSavedViewRequestSchema = z.object({
  name: savedListViewNameSchema,
  shared: z.boolean(),
  filters: savedListViewFiltersSchema,
  sort: savedListViewSortSchema,
  visibleColumns: savedListViewColumnsSchema.nullable().optional(),
});
export type CreateReturnSavedViewRequest = z.infer<typeof createReturnSavedViewRequestSchema>;

export const updateReturnSavedViewRequestSchema = createReturnSavedViewRequestSchema.partial();
export type UpdateReturnSavedViewRequest = z.infer<typeof updateReturnSavedViewRequestSchema>;
