// Meta Ads module — feature 064 contract surface.
//
// Holds the admin custom-event-mapping DTOs, the storefront per-channel config
// read, the storefront-action enum, the fixed action → Meta standard event map,
// and `META_ADS_SETTING_CODES`.

import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

// ---------------------------------------------------------------------------
// (1) Enumerations
// ---------------------------------------------------------------------------

/**
 * Storefront actions a Meta event can be bound to — one entry per emitter in
 * `storefront/lib/analytics/ecommerce.ts`. Same closed set as the LinkedIn
 * module: an operator cannot map an action the storefront never emits.
 */
export const metaTriggerActionSchema = z.enum([
  'product_viewed',
  'add_to_cart',
  'add_to_quote_request',
  'add_to_shopping_list',
  'begin_checkout',
  'place_order_clicked',
  'purchase',
  'contact_form_submitted',
]);
export type MetaTriggerAction = z.infer<typeof metaTriggerActionSchema>;

export const META_TRIGGER_ACTIONS: readonly MetaTriggerAction[] =
  metaTriggerActionSchema.options;

/**
 * Meta's documented standard event for each action, or `null` where Meta has no
 * matching standard name.
 *
 * Fixed in code, not operator-editable: Meta's optimisation, catalogue
 * matching, and ROAS reporting key off these exact names, so letting an
 * operator rename them would quietly downgrade their reporting. Actions with
 * `null` still accept a custom mapping — that is what custom mappings are for.
 */
export const META_STANDARD_EVENTS: Record<MetaTriggerAction, string | null> = {
  product_viewed: 'ViewContent',
  add_to_cart: 'AddToCart',
  add_to_quote_request: 'Lead',
  add_to_shopping_list: null,
  begin_checkout: 'InitiateCheckout',
  place_order_clicked: null,
  purchase: 'Purchase',
  contact_form_submitted: 'Lead',
};

/** Meta Pixel ID as shown in Events Manager. */
export const metaPixelIdSchema = z
  .string()
  .regex(/^[0-9]{1,32}$/, 'Pixel ID must be 1-32 digits');

/** Custom event name: letters, digits, underscore; Meta's practical shape. */
export const metaEventNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Invalid Meta event name');

// ---------------------------------------------------------------------------
// (2) Admin DTOs — custom event mappings
// ---------------------------------------------------------------------------

export const metaCustomEventMappingSchema = z.object({
  id: uuidSchema,
  /** `null` = applies to every sales channel. */
  salesChannelId: uuidSchema.nullable(),
  triggerAction: metaTriggerActionSchema,
  eventName: metaEventNameSchema,
  enabled: z.boolean(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MetaCustomEventMapping = z.infer<typeof metaCustomEventMappingSchema>;

export const createMetaCustomEventMappingSchema = z.object({
  salesChannelId: uuidSchema.nullable().optional(),
  triggerAction: metaTriggerActionSchema,
  eventName: metaEventNameSchema,
  enabled: z.boolean().optional(),
});
export type CreateMetaCustomEventMapping = z.infer<typeof createMetaCustomEventMappingSchema>;

export const updateMetaCustomEventMappingSchema = z.object({
  salesChannelId: uuidSchema.nullable().optional(),
  triggerAction: metaTriggerActionSchema.optional(),
  eventName: metaEventNameSchema.optional(),
  enabled: z.boolean().optional(),
  /** Current version held by the client — a mismatch is a 409. */
  version: z.number().int().positive(),
});
export type UpdateMetaCustomEventMapping = z.infer<typeof updateMetaCustomEventMappingSchema>;

// ---------------------------------------------------------------------------
// (3) Storefront config
// ---------------------------------------------------------------------------

export const metaStorefrontMappingSchema = z.object({
  triggerAction: metaTriggerActionSchema,
  eventName: metaEventNameSchema,
});
export type MetaStorefrontMapping = z.infer<typeof metaStorefrontMappingSchema>;

export const metaStorefrontConfigSchema = z.object({
  enabled: z.boolean(),
  /** `null` when unset — a blank Pixel ID means "not configured" (FR-004). */
  pixelId: z.string().nullable(),
  requireConsent: z.boolean(),
  /** Custom events reported *in addition to* the standard event for an action. */
  customEvents: z.array(metaStorefrontMappingSchema),
});
export type MetaStorefrontConfig = z.infer<typeof metaStorefrontConfigSchema>;

/** Fully-off config — the shape every failure path degrades to. */
export const META_DISABLED_CONFIG: MetaStorefrontConfig = {
  enabled: false,
  pixelId: null,
  requireConsent: true,
  customEvents: [],
};

// ---------------------------------------------------------------------------
// (4) Setting codes
// ---------------------------------------------------------------------------

export const META_ADS_SETTING_CODES = {
  ENABLED: 'meta_ads.enabled',
  PIXEL_ID: 'meta_ads.pixel_id',
  REQUIRE_CONSENT: 'meta_ads.require_consent',
} as const;
