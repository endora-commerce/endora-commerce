import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Feature 022 — per-Sales-Channel + per-Language product attribute overrides.
 *
 * Endpoints live under `/admin/products/:id/...` and use these schemas as
 * the source of truth for request/response shapes. See
 * specs/023-product-scope-editor/contracts/.
 */

// --- Primitives -------------------------------------------------------------

/** Attribute-key string used in override rows. */
export const attributeKeySchema = z.string().min(1).max(64);

/** BCP-47-ish language code. The dictionary module governs the active list. */
export const languageCodeSchema = z.string().min(1).max(16);

export const productEditorPreferenceFieldsSchema = z.object({
  lastChannelId: uuidSchema.nullable(),
  lastLanguageCode: languageCodeSchema.nullable(),
});
export type ProductEditorPreferenceFields = z.infer<typeof productEditorPreferenceFieldsSchema>;

// --- PUT /admin/products/:id/editor-preference ------------------------------

export const productEditorPreferenceRequestSchema = productEditorPreferenceFieldsSchema;
export type ProductEditorPreferenceRequest = z.infer<typeof productEditorPreferenceRequestSchema>;

export const productEditorPreferenceResponseSchema = z.object({
  productId: uuidSchema,
  adminUserId: uuidSchema,
  lastChannelId: uuidSchema.nullable(),
  lastLanguageCode: languageCodeSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type ProductEditorPreferenceResponse = z.infer<
  typeof productEditorPreferenceResponseSchema
>;
