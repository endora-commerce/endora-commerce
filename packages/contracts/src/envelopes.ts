import { z } from 'zod';
import { paginationSchema } from './pagination.js';

/** Successful item-response envelope. Example: `{ data: { id: '…', … } }`. */
export function dataEnvelope<T extends z.ZodTypeAny>(inner: T) {
  return z.object({
    data: inner,
  });
}

/** Successful collection-response envelope with cursor pagination. */
export function collectionEnvelope<T extends z.ZodTypeAny>(inner: T) {
  return z.object({
    data: z.array(inner),
    pagination: paginationSchema,
  });
}
