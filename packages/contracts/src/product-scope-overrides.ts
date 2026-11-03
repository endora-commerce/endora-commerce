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

/**
 * A removal of one override row, as the admin's scope overview names it. The `GET` / `PATCH
 * …/value-overrides` routes and their schemas were removed by feature 170 (T043); this shape is
 * kept while the admin imports it (S3).
 */
export const productValueOverrideDeleteSchema = z.object({
  attributeKey: attributeKeySchema,
  channelId: uuidSchema,
  languageCode: languageCodeSchema.nullable(),
});
export type ProductValueOverrideDelete = z.infer<typeof productValueOverrideDeleteSchema>;

// --- GET /admin/products/:id/scope-context (removed by feature 170; kept while the admin imports it, S3)

export const productScopeChannelSchema = z.object({
  id: uuidSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  languages: z.array(languageCodeSchema),
  isDefault: z.boolean(),
});
export type ProductScopeChannel = z.infer<typeof productScopeChannelSchema>;

export const productEditorPreferenceFieldsSchema = z.object({
  lastChannelId: uuidSchema.nullable(),
  lastLanguageCode: languageCodeSchema.nullable(),
});
export type ProductEditorPreferenceFields = z.infer<typeof productEditorPreferenceFieldsSchema>;

export const productScopeContextResponseSchema = z.object({
  productId: uuidSchema,
  channels: z.array(productScopeChannelSchema),
  languagesUnion: z.array(languageCodeSchema),
  primaryAdminLanguage: languageCodeSchema,
  preference: productEditorPreferenceFieldsSchema.nullable(),
});
export type ProductScopeContextResponse = z.infer<typeof productScopeContextResponseSchema>;

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
