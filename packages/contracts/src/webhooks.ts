import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Webhook + WebhookDelivery contracts (US7 / FR-121).
 */

export const webhookStatusSchema = z.enum(['active', 'paused']);
export type WebhookStatus = z.infer<typeof webhookStatusSchema>;

export const webhookSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  url: z.string().url(),
  eventTypes: z.array(z.string()),
  status: webhookStatusSchema,
  /**
   * Feature 062 — org-scoped delivery (additive). `null` = platform-wide
   * subscription (legacy semantics); a value restricts delivery to events
   * whose payload `organizationId` matches.
   */
  organizationId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Webhook = z.infer<typeof webhookSchema>;

export const createWebhookRequestSchema = z.object({
  name: z.string().min(1).max(160),
  url: z.string().url(),
  eventTypes: z.array(z.string().min(1)).min(1),
  /** Feature 062 — optional organization binding (additive; omitted/null = platform-wide). */
  organizationId: uuidSchema.nullable().optional(),
});
export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>;

export const updateWebhookRequestSchema = createWebhookRequestSchema.partial().extend({
  status: webhookStatusSchema.optional(),
});

export const webhookDeliveryStatusSchema = z.enum([
  'pending',
  'in_flight',
  'succeeded',
  'failed',
  'dead_lettered',
]);

export const webhookDeliverySchema = z.object({
  id: uuidSchema,
  webhookId: uuidSchema,
  eventId: z.string(),
  eventType: z.string(),
  status: webhookDeliveryStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  dispatchedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  deadLetteredAt: isoDateTimeSchema.nullable(),
  lastResponseStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
