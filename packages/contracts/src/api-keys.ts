import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * API key contracts (US7 / FR-120, extended by feature 062 Distributor API).
 * The plaintext bearer token is shown once at creation; only its sha256 hash
 * is stored.
 */

export const apiKeyStatusSchema = z.enum(['active', 'revoked']);
export type ApiKeyStatus = z.infer<typeof apiKeyStatusSchema>;

/**
 * Typed scope catalog (feature 062, research §R3). Enforcement stays
 * membership-based, so stored legacy free-text scopes remain readable and
 * enforceable — only *creation* validates against this enum.
 *
 * - `catalog:read`  — PIM reads (unbound) AND distributor catalog surface (bound)
 * - `catalog:write` — PIM by-SKU upsert — UNBOUND KEYS ONLY
 * - `orders:read`   — distributor order reads — BOUND KEYS ONLY
 * - `orders:write`  — distributor order intake — BOUND KEYS ONLY
 */
export const apiKeyScopeSchema = z.enum([
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
]);
export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

/**
 * Distributor binding (feature 062, contracts/api-key-binding.md §2).
 * All-or-none: a key is either fully bound (org + channel + designated
 * service customer account) or fully unbound. Immutable post-create.
 */
export const apiKeyBindingSchema = z.object({
  organizationId: uuidSchema,
  salesChannelId: uuidSchema,
  /** Must reference an active customer account belonging to `organizationId`. */
  customerAccountId: uuidSchema,
});
export type ApiKeyBinding = z.infer<typeof apiKeyBindingSchema>;

export const apiKeySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  lastFour: z.string(),
  scopes: z.array(z.string()),
  status: apiKeyStatusSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
  revokedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  // Feature 062 — additive binding/expiry fields; always present, null for
  // unbound / non-expiring keys.
  organizationId: uuidSchema.nullable(),
  salesChannelId: uuidSchema.nullable(),
  customerAccountId: uuidSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const createApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(160),
  scopes: z.array(apiKeyScopeSchema).min(1),
  binding: apiKeyBindingSchema.optional(),
  expiresAt: isoDateTimeSchema.optional(),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

export const createApiKeyResponseSchema = z.object({
  apiKey: apiKeySchema,
  /** The raw bearer token, only returned once at creation. */
  bearerToken: z.string(),
});
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;
