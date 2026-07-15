// Google Analytics module — feature 049 contract surface.
//
// Holds the Zod request/response schemas for the admin custom-events CRUD, the
// storefront per-channel config read, the server-side collect (producer) ingest,
// the trigger-action enum + field catalogue shared by the admin field-picker and
// the storefront collector, and the `GOOGLE_ANALYTICS_SETTING_CODES` const shared
// between the settings manifest and the module's services.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// (1) Enumerations
// ---------------------------------------------------------------------------

/**
 * Storefront interactions a custom event can be bound to. All are client-side
 * observable; every listed payload is available in the browser at trigger time
 * (research §R5).
 */
export const gaTriggerActionSchema = z.enum([
  'contact_form_submitted',
  'place_order_clicked',
  'add_to_cart',
  'add_to_quote_request',
  'add_to_shopping_list',
  'button_click_by_id',
]);
export type GaTriggerAction = z.infer<typeof gaTriggerActionSchema>;

// ---------------------------------------------------------------------------
// (2) Field catalogue (shared: admin field-picker + storefront collector)
// ---------------------------------------------------------------------------

/**
 * Per-action available payload fields. `static` is the closed set offered as
 * checkboxes in the admin; `null` means the field set is dynamic/free-form
 * (form fields, order payload keys, button `data-*` names) and the admin adds
 * keys by hand. `contact_form_submitted` never exposes file uploads (FR-018).
 */
export const GA_ACTION_FIELD_CATALOGUE: Record<
  GaTriggerAction,
  { static: readonly string[] | null }
> = {
  contact_form_submitted: { static: null },
  place_order_clicked: { static: null },
  add_to_cart: { static: ['sku', 'name', 'price', 'quantity'] },
  add_to_quote_request: { static: ['sku', 'name', 'price', 'quantity'] },
  add_to_shopping_list: { static: ['sku', 'name', 'price', 'quantity'] },
  button_click_by_id: { static: null },
};

/** GA4 event-name shape: starts with a letter, letters/digits/underscore, ≤40. */
export const gaEventNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, 'Invalid GA4 event name');

/** GA4 param-name shape: starts with a letter, letters/digits/underscore, ≤128. */
export const gaParamKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,127}$/, 'Invalid GA4 parameter name');

// ---------------------------------------------------------------------------
// (3) Custom event — admin DTOs
// ---------------------------------------------------------------------------

export const gaCustomEventFieldSchema = z.object({
  fieldKey: gaParamKeySchema,
  payloadKey: gaParamKeySchema.optional(),
  position: z.number().int().min(0),
});
export type GaCustomEventField = z.infer<typeof gaCustomEventFieldSchema>;

/**
 * `buttonId` is required iff the action is `button_click_by_id` and forbidden
 * otherwise; static-set actions restrict `fields[].fieldKey` to the catalogue.
 * Applied inline on each schema (a shared generic helper trips
 * exactOptionalPropertyTypes).
 */
function buttonIdOk(action: GaTriggerAction | undefined, buttonId: string | null | undefined): boolean {
  if (action === undefined) return true;
  return action === 'button_click_by_id'
    ? typeof buttonId === 'string' && buttonId.length > 0
    : buttonId === undefined || buttonId === null;
}

function fieldsOk(
  action: GaTriggerAction | undefined,
  fields: GaCustomEventField[] | undefined,
): boolean {
  if (action === undefined || fields === undefined) return true;
  const allowed = GA_ACTION_FIELD_CATALOGUE[action].static;
  if (allowed === null) return true;
  return fields.every((f) => allowed.includes(f.fieldKey));
}

export const gaCustomEventCreateSchema = z
  .object({
    salesChannelCode: z.string().optional(),
    eventName: gaEventNameSchema,
    triggerAction: gaTriggerActionSchema,
    buttonId: z.string().max(128).optional(),
    enabled: z.boolean().default(true),
    fields: z.array(gaCustomEventFieldSchema).default([]),
  })
  .refine((v) => buttonIdOk(v.triggerAction, v.buttonId), {
    message: 'buttonId is required for button_click_by_id and forbidden otherwise',
    path: ['buttonId'],
  })
  .refine((v) => fieldsOk(v.triggerAction, v.fields), {
    message: 'A selected field is not available for this action',
    path: ['fields'],
  });
export type GaCustomEventCreate = z.infer<typeof gaCustomEventCreateSchema>;

export const gaCustomEventUpdateSchema = z
  .object({
    salesChannelCode: z.string().nullable().optional(),
    eventName: gaEventNameSchema.optional(),
    triggerAction: gaTriggerActionSchema.optional(),
    buttonId: z.string().max(128).nullable().optional(),
    enabled: z.boolean().optional(),
    fields: z.array(gaCustomEventFieldSchema).optional(),
    version: z.number().int().min(1),
  })
  .refine((v) => buttonIdOk(v.triggerAction, v.buttonId), {
    message: 'buttonId is required for button_click_by_id and forbidden otherwise',
    path: ['buttonId'],
  })
  .refine((v) => fieldsOk(v.triggerAction, v.fields), {
    message: 'A selected field is not available for this action',
    path: ['fields'],
  });
export type GaCustomEventUpdate = z.infer<typeof gaCustomEventUpdateSchema>;

export const gaCustomEventResponseSchema = z.object({
  id: z.uuid(),
  salesChannelCode: z.string().nullable(),
  eventName: z.string(),
  triggerAction: gaTriggerActionSchema,
  buttonId: z.string().nullable(),
  enabled: z.boolean(),
  fields: z.array(gaCustomEventFieldSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  version: z.number().int(),
});
export type GaCustomEventResponse = z.infer<typeof gaCustomEventResponseSchema>;

export const gaCustomEventListQuerySchema = z.object({
  salesChannelCode: z.string().optional(),
  triggerAction: gaTriggerActionSchema.optional(),
});
export type GaCustomEventListQuery = z.infer<typeof gaCustomEventListQuerySchema>;

// ---------------------------------------------------------------------------
// (4) Storefront — per-channel public config
// ---------------------------------------------------------------------------

export const gaStorefrontCustomEventSchema = z.object({
  eventName: z.string(),
  triggerAction: gaTriggerActionSchema,
  buttonId: z.string().nullable(),
  fields: z.array(z.object({ fieldKey: z.string(), payloadKey: z.string() })),
});
export type GaStorefrontCustomEvent = z.infer<typeof gaStorefrontCustomEventSchema>;

export const gaStorefrontConfigSchema = z.object({
  /** Master switch AND measurement-id presence resolved server-side. */
  enabled: z.boolean(),
  measurementId: z.string().nullable(),
  enhancedEcommerce: z.boolean(),
  /** When true the browser routes events to /collect instead of gtag (no double count). */
  serverSide: z.boolean(),
  /** Drives Consent Mode v2 default state. */
  requireConsent: z.boolean(),
  customEvents: z.array(gaStorefrontCustomEventSchema),
});
export type GaStorefrontConfig = z.infer<typeof gaStorefrontConfigSchema>;

// ---------------------------------------------------------------------------
// (5) Storefront — server-side collect (producer ingest)
// ---------------------------------------------------------------------------

export const gaCollectEventSchema = z.object({
  name: z.string().min(1).max(64),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type GaCollectEvent = z.infer<typeof gaCollectEventSchema>;

export const gaCollectRequestSchema = z.object({
  clientId: z.string().min(1).max(128),
  consent: z.object({
    analyticsStorage: z.enum(['granted', 'denied']),
  }),
  events: z.array(gaCollectEventSchema).min(1).max(25),
});
export type GaCollectRequest = z.infer<typeof gaCollectRequestSchema>;

// ---------------------------------------------------------------------------
// (6) Setting codes (shared between manifest + services)
// ---------------------------------------------------------------------------

export const GOOGLE_ANALYTICS_SETTING_CODES = {
  ENABLED: 'google_analytics.enabled',
  MEASUREMENT_ID: 'google_analytics.measurement_id',
  ENHANCED_ECOMMERCE_ENABLED: 'google_analytics.enhanced_ecommerce_enabled',
  SERVER_SIDE_ENABLED: 'google_analytics.server_side_enabled',
  SERVER_SIDE_ENDPOINT: 'google_analytics.server_side_endpoint',
  SERVER_SIDE_API_SECRET: 'google_analytics.server_side_api_secret',
  REQUIRE_CONSENT: 'google_analytics.require_consent',
} as const;
