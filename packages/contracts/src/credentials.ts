import { z } from 'zod';

/**
 * Credentials module (feature 058) — boundary schemas.
 *
 * The credentials core is type-agnostic (Principle XIV): a "configuration type"
 * is a code-registered descriptor declaring its provider variants and per-field
 * definitions (some `secret`). The core stores/validates the declared fields but
 * never interprets provider meaning. These schemas are the single source of
 * truth for the admin API and the in-process configuration-type registry.
 *
 * Secret field values are NEVER returned in plaintext by any read: the DTO
 * replaces them with an `isSet` boolean. Only the server-side `resolve` path
 * (not modelled as an HTTP response) exposes decrypted values for consumer use.
 */

// ---------------------------------------------------------------------------
// Configuration-type descriptors (registry surface)
// ---------------------------------------------------------------------------

/** Frozen field-kind set. */
export const CREDENTIAL_FIELD_KINDS = ['string', 'number', 'boolean', 'select'] as const;
export const FieldKindSchema = z.enum(CREDENTIAL_FIELD_KINDS);
export type FieldKind = z.infer<typeof FieldKindSchema>;

export const FieldOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type FieldOption = z.infer<typeof FieldOptionSchema>;

export const FieldDefinitionSchema = z.object({
  key: z.string().min(1),
  label: z.string(),
  kind: FieldKindSchema,
  required: z.boolean(),
  secret: z.boolean(),
  options: z.array(FieldOptionSchema).optional(),
  placeholder: z.string().optional(),
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const ProviderVariantSchema = z.object({
  code: z.string().min(1),
  label: z.string(),
  fields: z.array(FieldDefinitionSchema),
});
export type ProviderVariant = z.infer<typeof ProviderVariantSchema>;

export const ConfigurationTypeDescriptorSchema = z.object({
  code: z.string().min(1),
  label: z.string(),
  ownerModule: z.string().min(1),
  providers: z.array(ProviderVariantSchema),
});
export type ConfigurationTypeDescriptor = z.infer<typeof ConfigurationTypeDescriptorSchema>;

/** `GET /api/v1/admin/credentials/types` response. */
export const ConfigurationTypesResponseSchema = z.object({
  types: z.array(ConfigurationTypeDescriptorSchema),
});
export type ConfigurationTypesResponse = z.infer<typeof ConfigurationTypesResponseSchema>;

// ---------------------------------------------------------------------------
// Write requests
// ---------------------------------------------------------------------------

/** `POST /api/v1/admin/credentials` body. */
export const CreateConfigurationSchema = z.object({
  code: z.string().min(1).max(128),
  name: z.string().min(1).max(255),
  typeCode: z.string().min(1).max(64),
  providerCode: z.string().min(1).max(64),
  /** Field-value bag keyed by `FieldDefinition.key`; validated per descriptor. */
  values: z.record(z.string(), z.unknown()),
});
export type CreateConfiguration = z.infer<typeof CreateConfigurationSchema>;

/**
 * `PUT /api/v1/admin/credentials/:code` body.
 *
 * `typeCode`/`providerCode` are intentionally absent — they are immutable after
 * create (a change is rejected with `CREDENTIAL_TYPE_IMMUTABLE`). A secret field
 * omitted or submitted blank/`[redacted]` preserves the stored envelope
 * (write-only semantics, FR-015). `expectedVersion` drives the optimistic lock.
 */
export const UpdateConfigurationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type UpdateConfiguration = z.infer<typeof UpdateConfigurationSchema>;

// ---------------------------------------------------------------------------
// Read DTO (secrets masked)
// ---------------------------------------------------------------------------

/**
 * One field in a masked configuration DTO. Secret fields carry only `isSet`
 * (never a value); non-secret fields carry their plain `value`.
 */
export const ConfigurationFieldDtoSchema = z.object({
  key: z.string(),
  secret: z.boolean(),
  /** Present for secret fields — whether a secret is stored. */
  isSet: z.boolean().optional(),
  /** Present for non-secret fields — the plain stored value. */
  value: z.unknown().optional(),
});
export type ConfigurationFieldDto = z.infer<typeof ConfigurationFieldDtoSchema>;

export const ConfigurationDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  typeCode: z.string(),
  /** Null when the type is no longer registered (inert). */
  typeLabel: z.string().nullable(),
  providerCode: z.string(),
  /** Null when the type/provider is no longer registered (inert). */
  providerLabel: z.string().nullable(),
  /** True when `typeCode` is no longer registered; the row renders read-only. */
  inert: z.boolean(),
  fields: z.array(ConfigurationFieldDtoSchema),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type ConfigurationDto = z.infer<typeof ConfigurationDtoSchema>;

/** `GET /api/v1/admin/credentials` response. */
export const ConfigurationListResponseSchema = z.object({
  configurations: z.array(ConfigurationDtoSchema),
});
export type ConfigurationListResponse = z.infer<typeof ConfigurationListResponseSchema>;

/** Optional `?type=` filter on the list endpoint. */
export const ConfigurationListQuerySchema = z.object({
  type: z.string().min(1).max(64).optional(),
});
export type ConfigurationListQuery = z.infer<typeof ConfigurationListQuerySchema>;

/** Delete-blocked payload — the settings referencing a configuration (FR-012). */
export const ConfigurationReferenceSchema = z.object({
  settingCode: z.string(),
  salesChannelCode: z.string().optional(),
});
export type ConfigurationReference = z.infer<typeof ConfigurationReferenceSchema>;

// ---------------------------------------------------------------------------
// Server-side resolution (never an HTTP response body)
// ---------------------------------------------------------------------------

/** Frozen resolution-status set. */
export const CREDENTIAL_RESOLVE_STATUSES = ['ok', 'not_configured', 'unavailable'] as const;
export const CREDENTIAL_UNAVAILABLE_REASONS = ['missing', 'inert_type'] as const;

/**
 * Discriminated result of `CredentialsService.resolve(code)`. `ok` carries
 * decrypted secret values for in-memory consumer use only; the other variants
 * fail closed (never a foreign configuration, never a plaintext leak).
 */
export const ResolveResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    typeCode: z.string(),
    providerCode: z.string(),
    values: z.record(z.string(), z.unknown()),
  }),
  z.object({ status: z.literal('not_configured') }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(CREDENTIAL_UNAVAILABLE_REASONS),
  }),
]);
export type ResolveResult = z.infer<typeof ResolveResultSchema>;
