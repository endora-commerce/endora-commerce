import { z } from 'zod';

/**
 * Cursor-based pagination payload — see
 * specs/001-b2b-platform-foundation/contracts/README.md.
 *
 * Offset pagination is deliberately rejected because it degrades on large catalogs (R-08).
 */

export const paginationSchema = z.object({
  cursor: z.string().nullable().describe('opaque base64 cursor for the next page; null on last page'),
  hasMore: z.boolean(),
  limit: z.number().int().positive().max(200),
});

export type Pagination = z.infer<typeof paginationSchema>;

/** Shared query parameters for every list endpoint. */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
  sort: z.string().optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

// NOTE: cursor encode/decode helpers live in the backend (see backend/src/http/cursor.ts)
// because Node's Buffer is not available in the browser and the frontends treat the cursor
// as opaque.
