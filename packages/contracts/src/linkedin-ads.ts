// LinkedIn Ads module — feature 063 contract surface.
//
// Holds the Zod request/response schemas for the admin conversion-mapping CRUD,
// the storefront per-channel config read, the server-side conversion ingest, the
// trigger-action enum shared by the admin picker and the storefront dispatcher,
// and the `LINKEDIN_ADS_SETTING_CODES` const shared between the settings
// manifest and the module's services.

import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

// ---------------------------------------------------------------------------
// (1) Enumerations
// ---------------------------------------------------------------------------

/**
 * Storefront actions a LinkedIn conversion can be bound to.
 *
 * Deliberately a closed set matching the call sites that already exist in the
 * storefront's commerce-event layer (plus registration). An operator cannot map
 * an action the storefront never emits, which is what makes "no mapping" a
 * normal state rather than a silent misconfiguration (FR-012).
 */
export const linkedInTriggerActionSchema = z.enum([
  'product_viewed',
  'add_to_cart',
  'begin_checkout',
  'purchase',
  'quote_request_submitted',
  'contact_form_submitted',
  'account_registered',
]);
export type LinkedInTriggerAction = z.infer<typeof linkedInTriggerActionSchema>;

export const LINKEDIN_TRIGGER_ACTIONS: readonly LinkedInTriggerAction[] =
  linkedInTriggerActionSchema.options;

// ---------------------------------------------------------------------------
// (2) Field-level patterns
// ---------------------------------------------------------------------------

/**
 * Campaign Manager shows a conversion as a numeric id. Stored as text because
 * it is an identifier — it is never used in arithmetic and leading zeros, if
 * LinkedIn ever emits them, must survive a round trip.
 */
export const linkedInConversionIdSchema = z
  .string()
  .regex(/^[0-9]{1,32}$/, 'Conversion ID must be 1-32 digits');

/**
 * The Conversions API addresses a conversion rule by URN rather than by the
 * bare numeric id shown in the UI. Derived from the id when the operator does
 * not override it (see `conversionRuleUrnFor`).
 */
export const linkedInConversionRuleUrnSchema = z
  .string()
  .regex(
    /^urn:lla:llaPartnerConversion:[0-9]{1,32}$/,
    'Conversion rule URN must look like urn:lla:llaPartnerConversion:<digits>',
  );

/** Insight Tag Partner ID as shown in Campaign Manager. */
export const linkedInPartnerIdSchema = z
  .string()
  .regex(/^[0-9]{1,20}$/, 'Partner ID must be 1-20 digits');

/** Build the Conversions API URN for a numeric conversion id. */
export function conversionRuleUrnFor(conversionId: string): string {
  return `urn:lla:llaPartnerConversion:${conversionId}`;
}

// ---------------------------------------------------------------------------
// (3) Admin DTOs — conversion mappings
// ---------------------------------------------------------------------------

export const linkedInConversionMappingSchema = z.object({
  id: uuidSchema,
  /** `null` = the mapping applies to every sales channel. */
  salesChannelId: uuidSchema.nullable(),
  triggerAction: linkedInTriggerActionSchema,
  conversionId: linkedInConversionIdSchema,
  /** `null` = derive from `conversionId` at delivery time. */
  conversionRuleUrn: linkedInConversionRuleUrnSchema.nullable(),
  enabled: z.boolean(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type LinkedInConversionMapping = z.infer<typeof linkedInConversionMappingSchema>;

export const createLinkedInConversionMappingSchema = z.object({
  salesChannelId: uuidSchema.nullable().optional(),
  triggerAction: linkedInTriggerActionSchema,
  conversionId: linkedInConversionIdSchema,
  conversionRuleUrn: linkedInConversionRuleUrnSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});
export type CreateLinkedInConversionMapping = z.infer<
  typeof createLinkedInConversionMappingSchema
>;

export const updateLinkedInConversionMappingSchema = z.object({
  salesChannelId: uuidSchema.nullable().optional(),
  triggerAction: linkedInTriggerActionSchema.optional(),
  conversionId: linkedInConversionIdSchema.optional(),
  conversionRuleUrn: linkedInConversionRuleUrnSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  /** Current version held by the client — a mismatch is a 409. */
  version: z.number().int().positive(),
});
export type UpdateLinkedInConversionMapping = z.infer<
  typeof updateLinkedInConversionMappingSchema
>;

// ---------------------------------------------------------------------------
// (4) Storefront config
// ---------------------------------------------------------------------------

/** One mapping as the storefront needs it — no ids, no audit columns. */
export const linkedInStorefrontMappingSchema = z.object({
  triggerAction: linkedInTriggerActionSchema,
  conversionId: linkedInConversionIdSchema,
});
export type LinkedInStorefrontMapping = z.infer<typeof linkedInStorefrontMappingSchema>;

export const linkedInStorefrontConfigSchema = z.object({
  enabled: z.boolean(),
  /** `null` when unset — a blank Partner ID means "not configured" (FR-004). */
  partnerId: z.string().nullable(),
  requireConsent: z.boolean(),
  /**
   * When true the browser still loads the Insight Tag (audiences, page-level
   * rules) but must NOT fire mapped conversions — the backend reports them, so
   * each conversion has exactly one transport.
   */
  serverSide: z.boolean(),
  conversionMappings: z.array(linkedInStorefrontMappingSchema),
});
export type LinkedInStorefrontConfig = z.infer<typeof linkedInStorefrontConfigSchema>;

/** Fully-off config — the shape every failure path degrades to. */
export const LINKEDIN_DISABLED_CONFIG: LinkedInStorefrontConfig = {
  enabled: false,
  partnerId: null,
  requireConsent: true,
  serverSide: false,
  conversionMappings: [],
};

// ---------------------------------------------------------------------------
// (5) Server-side conversion ingest
// ---------------------------------------------------------------------------

export const linkedInConversionAmountSchema = z.object({
  currencyCode: z.string().length(3),
  amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, 'Amount must be a decimal string'),
});

export const linkedInConversionIngestSchema = z.object({
  triggerAction: linkedInTriggerActionSchema,
  /** LinkedIn click identifier captured from the landing URL. */
  liFatId: z.string().max(256).optional(),
  /**
   * Hashed server-side and immediately discarded — the raw address is never
   * persisted and never placed on the queue (FR-017).
   */
  email: z.string().email().optional(),
  amount: linkedInConversionAmountSchema.optional(),
  /** Idempotency handle so a retry cannot double-report. */
  eventId: z.string().min(1).max(128),
  /** Epoch milliseconds; defaults to receipt time when absent. */
  conversionHappenedAt: z.number().int().positive().optional(),
});
export type LinkedInConversionIngest = z.infer<typeof linkedInConversionIngestSchema>;

export const linkedInConversionIngestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// (6) Setting codes
// ---------------------------------------------------------------------------

export const LINKEDIN_ADS_SETTING_CODES = {
  ENABLED: 'linkedin_ads.enabled',
  PARTNER_ID: 'linkedin_ads.partner_id',
  REQUIRE_CONSENT: 'linkedin_ads.require_consent',
  SERVER_SIDE_ENABLED: 'linkedin_ads.server_side_enabled',
  ACCESS_TOKEN: 'linkedin_ads.access_token',
} as const;
