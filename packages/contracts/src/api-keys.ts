import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * API key contracts (US7 / FR-120). The plaintext bearer token is shown
 * once at creation; only its sha256 hash is stored.
 */

export const apiKeyStatusSchema = z.enum(['active', 'revoked']);
export type ApiKeyStatus = z.infer<typeof apiKeyStatusSchema>;

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
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const createApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(160),
  scopes: z.array(z.string().min(1)).min(1),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

export const createApiKeyResponseSchema = z.object({
  apiKey: apiKeySchema,
  /** The raw bearer token, only returned once at creation. */
  bearerToken: z.string(),
});
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;
