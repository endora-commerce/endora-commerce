import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * External integration contracts (US7 / FR-122). The `config` payload is an
 * arbitrary JSON object — the backend encrypts it at rest and never echoes
 * it back via GET responses (only redacted fields).
 */

export const integrationStatusSchema = z.enum(['active', 'inactive', 'error']);

export const externalIntegrationSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  vendor: z.string(),
  kind: z.string(),
  status: integrationStatusSchema,
  lastTestedAt: isoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ExternalIntegration = z.infer<typeof externalIntegrationSchema>;

export const createIntegrationRequestSchema = z.object({
  name: z.string().min(1).max(160),
  vendor: z.string().min(1).max(64),
  kind: z.string().min(1).max(32),
  config: z.record(z.string(), z.unknown()),
});
export type CreateIntegrationRequest = z.infer<typeof createIntegrationRequestSchema>;

export const updateIntegrationRequestSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  status: integrationStatusSchema.optional(),
});

export const integrationTestResultSchema = z.object({
  ok: z.boolean(),
  status: integrationStatusSchema,
  testedAt: isoDateTimeSchema,
  message: z.string().optional(),
});
export type IntegrationTestResult = z.infer<typeof integrationTestResultSchema>;
