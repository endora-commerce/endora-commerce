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

// ---------------------------------------------------------------------------
// Contributed event types (specs/143-crm-sales-opportunities/, research R-27)
// ---------------------------------------------------------------------------

/** One event type a module offers for outbound delivery. */
export interface WebhookEventDescriptor {
  /** The contributing module — an absent owner's event types are not offered. */
  readonly ownerModuleId: string;
  /** A versioned EventBus event name, e.g. `crm.opportunity.status_changed.v1`. */
  readonly eventType: string;
}

/**
 * Container name: `webhookEventRegistry`. Owner: `webhooks`.
 *
 * The registry a module pushes the event types it offers into. `webhooks`
 * names no contributor's event: a pushed type is bridged to the delivery queue
 * exactly as the built-in ones are, and offered on the subscription form.
 *
 * A **contribution seam**: contributors push from a contribution-only boot hook
 * and read nothing back, so the registration is a plain `ctx.di.register`
 * rather than a `providePort` — a boot hook that resolved a gate would stop the
 * backend from starting whenever `webhooks` was switched off. The contributor
 * declares the edge as `contributes-to`; nothing of the contributor degrades
 * without it.
 *
 * **Owner off:** a pushed type is recorded all the same, and nothing is
 * delivered — the bridge is `webhooks`' own gated subscription, so it does not
 * run. Events emitted meanwhile are not delivered later.
 *
 * **Enumeration policy: an absent contributor's event types are not offered.**
 * `list()` leaves out a type whose owner is not effectively present, so the
 * subscription form does not offer an event nothing can emit. Existing
 * subscriptions naming it stay stored and simply receive nothing; they receive
 * again when the owner is back. `owners()` stays presence-blind, for
 * diagnostics and for the composition tests that assert who contributed.
 */
export interface WebhookEventRegistryPort {
  /** Idempotent per event type: the same type pushed twice is bridged once. */
  register(descriptor: WebhookEventDescriptor): void;
  /** The contributing module of every registered type, in registration order, each once. */
  owners(): readonly string[];
  /** Event types whose owner is effectively present, in registration order. */
  list(): readonly WebhookEventDescriptor[];
}
