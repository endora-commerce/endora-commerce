import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Custom Fields Layer (feature 055) — entity-agnostic runtime custom fields
 * on core entities (Category, Order, Organization, Customer, QuoteRequest).
 *
 * These are the source-of-truth boundary schemas (Principle V). The per-value
 * validator applied to host records is DERIVED at runtime from a stored
 * definition (see backend `custom-field-value.service.ts`); the schemas here
 * cover the definition/option admin API and the value-bag envelope.
 */

/** The host entity types custom fields may attach to at launch. Extensible via the backend registry. */
export const supportedEntityTypeSchema = z.enum([
  'category',
  'order',
  'organization',
  'customer',
  'quote_request',
]);
export type SupportedEntityType = z.infer<typeof supportedEntityTypeSchema>;

/** The set of runtime value types. `text` is stored as a string; `select` stores one option value; `multiselect` an array. */
export const customFieldValueTypeSchema = z.enum([
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multiselect',
]);
export type CustomFieldValueType = z.infer<typeof customFieldValueTypeSchema>;

/** Per-locale label map (BCP-47-keyed). Empty is allowed when only `labelDefault` is filled. */
export const localizedLabelSchema = z.record(z.string(), z.string());
export type LocalizedLabel = z.infer<typeof localizedLabelSchema>;

/** A select/multiselect option. `id` absent on create. */
export const customFieldOptionSchema = z.object({
  id: uuidSchema.optional(),
  value: z.string().min(1).max(200),
  label: localizedLabelSchema.default({}),
  labelDefault: z.string().min(1).max(200),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
export type CustomFieldOptionDto = z.infer<typeof customFieldOptionSchema>;

/** A full custom-field definition, options embedded. */
export const customFieldDefinitionSchema = z.object({
  id: uuidSchema,
  entityType: supportedEntityTypeSchema,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: localizedLabelSchema,
  labelDefault: z.string().min(1).max(200),
  valueType: customFieldValueTypeSchema,
  required: z.boolean(),
  sortOrder: z.number().int(),
  // Opaque host-capability flags (FR-006). The generic core stores but never
  // interprets `config`; a host module reads its own flags from here.
  config: z.record(z.string(), z.unknown()).default({}),
  options: z.array(customFieldOptionSchema).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CustomFieldDefinitionDto = z.infer<typeof customFieldDefinitionSchema>;

/** Create a definition. `entityType` + `key` are immutable after create. */
export const createCustomFieldDefinitionSchema = customFieldDefinitionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateCustomFieldDefinitionRequest = z.infer<typeof createCustomFieldDefinitionSchema>;

/** Patch a definition. `entityType` and `key` cannot change once records may hold values. */
export const updateCustomFieldDefinitionSchema = createCustomFieldDefinitionSchema
  .partial()
  .omit({ entityType: true, key: true });
export type UpdateCustomFieldDefinitionRequest = z.infer<typeof updateCustomFieldDefinitionSchema>;

/** A validated value bag keyed by definition `key`. Values are typed by their definition's `valueType`. */
export const customFieldValuesSchema = z.record(z.string(), z.unknown());
export type CustomFieldValues = z.infer<typeof customFieldValuesSchema>;

/** One per-field validation failure returned to the admin for per-field rendering (FR-004). */
export const customFieldValidationErrorSchema = z.object({
  field: z.string(),
  code: z.enum([
    'wrong_type',
    'missing_required',
    'unknown_option',
    'out_of_range',
    'duplicate_option',
  ]),
  message: z.string(),
});
export type CustomFieldValidationError = z.infer<typeof customFieldValidationErrorSchema>;
