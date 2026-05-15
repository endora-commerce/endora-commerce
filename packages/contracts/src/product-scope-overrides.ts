import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Feature 022 — per-Sales-Channel + per-Language product attribute overrides.
 *
 * Endpoints live under `/admin/products/:id/...` and use these schemas as
 * the source of truth for request/response shapes. See
 * specs/022-product-scope-editor/contracts/.
 */

// --- Primitives -------------------------------------------------------------

/** Attribute-key string used in override rows. */
export const attributeKeySchema = z.string().min(1).max(64);

/** BCP-47-ish language code. The dictionary module governs the active list. */
export const languageCodeSchema = z.string().min(1).max(16);

/** Wrapped value column shape — `{ v: ... }` keeps the JSONB an object. */
export const overrideValueSchema = z.object({ v: z.unknown() });

// --- GET /admin/products/:id/value-overrides --------------------------------

export const productValueOverrideSchema = z.object({
  id: uuidSchema,
  attributeKey: attributeKeySchema,
  channelId: uuidSchema,
  languageCode: languageCodeSchema.nullable(),
  value: overrideValueSchema,
  updatedAt: isoDateTimeSchema,
});
export type ProductValueOverride = z.infer<typeof productValueOverrideSchema>;

export const productValueOverridesGetResponseSchema = z.object({
  productId: uuidSchema,
  overrides: z.array(productValueOverrideSchema),
});
export type ProductValueOverridesGetResponse = z.infer<
  typeof productValueOverridesGetResponseSchema
>;

// --- PATCH /admin/products/:id/value-overrides ------------------------------

export const productValueOverrideUpsertSchema = z.object({
  attributeKey: attributeKeySchema,
  channelId: uuidSchema,
  languageCode: languageCodeSchema.nullable(),
  value: overrideValueSchema,
});
export type ProductValueOverrideUpsert = z.infer<typeof productValueOverrideUpsertSchema>;

export const productValueOverrideDeleteSchema = z.object({
  attributeKey: attributeKeySchema,
  channelId: uuidSchema,
  languageCode: languageCodeSchema.nullable(),
});
export type ProductValueOverrideDelete = z.infer<typeof productValueOverrideDeleteSchema>;

export const productValueOverridesPatchRequestSchema = z.object({
  upserts: z.array(productValueOverrideUpsertSchema).default([]),
  deletes: z.array(productValueOverrideDeleteSchema).default([]),
});
export type ProductValueOverridesPatchRequest = z.infer<
  typeof productValueOverridesPatchRequestSchema
>;

export const productValueOverridesPatchResponseSchema = z.object({
  productId: uuidSchema,
  applied: z.object({
    upserted: z.number().int().min(0),
    deleted: z.number().int().min(0),
  }),
  overrides: z.array(productValueOverrideSchema),
});
export type ProductValueOverridesPatchResponse = z.infer<
  typeof productValueOverridesPatchResponseSchema
>;

// --- GET /admin/products/:id/scope-context ----------------------------------

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
