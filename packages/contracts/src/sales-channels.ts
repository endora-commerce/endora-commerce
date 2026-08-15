// Sales Channels module — feature 005 contract surface.
// Single file with logical sections (matching the convention used by every
// other module in @b2b/contracts):
//   (1) Identity primitives (channel code, summary, detail).
//   (2) Resolver middleware contract (header / query schemas).
//   (3) Admin HTTP request/response schemas (list / detail / create / edit
//       / lifecycle).
//   (4) Membership endpoints (the bidirectional channel-side / entity-side
//       routes; one shape, used by all 10 entity types).
//   (5) Storefront / public read-only schemas.
//   (6) Audit-action constants — free-form action strings written through
//       the existing AuditLogService.
// See specs/005-sales-channels/contracts/sales-channels-005.contract.md
// for the prose contract and the error-code references in `errors.ts`.

import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

// ---------------------------------------------------------------------------
// (1) Identity primitives
// ---------------------------------------------------------------------------

/**
 * Machine-friendly Sales Channel code. Lower-case, starts with a letter,
 * may contain digits, hyphens, and underscores. Stored as `varchar(32)`
 * (foundation 001).
 */
export const SalesChannelCodeSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9_-]*$/, 'sales channel code must be lowercase machine-friendly');
export type SalesChannelCode = z.infer<typeof SalesChannelCodeSchema>;

/** i18n display name keyed by language code, e.g. `{ en: 'Default' }`. */
export const SalesChannelNameSchema = z
  .record(z.string(), z.string())
  .refine((o) => Object.keys(o).length > 0, 'name must include at least one locale');
export type SalesChannelName = z.infer<typeof SalesChannelNameSchema>;

/** Short summary returned in list views. */
export const SalesChannelSummarySchema = z.object({
  id: uuidSchema,
  code: SalesChannelCodeSchema,
  name: SalesChannelNameSchema,
  active: z.boolean(),
  systemDefault: z.boolean(),
  defaultLanguage: z.string(),
  defaultCurrency: z.string(),
  themeCode: z.string().nullable(),
  logoAssetId: uuidSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type SalesChannelSummary = z.infer<typeof SalesChannelSummarySchema>;

/** Full detail returned by the admin GET-by-code endpoint. */
export const SalesChannelDetailSchema = SalesChannelSummarySchema.extend({
  languages: z.array(z.string()).min(1),
  currencies: z.array(z.string()).min(1),
  /** Resolved through the assets module on response; nullable when no logo set. */
  logoUrl: z.string().url().nullable(),
});
export type SalesChannelDetail = z.infer<typeof SalesChannelDetailSchema>;

// ---------------------------------------------------------------------------
// (2) Resolver middleware contract
// ---------------------------------------------------------------------------

/** `X-Sales-Channel: <code>` header schema. */
export const SalesChannelHeaderSchema = z.object({
  'x-sales-channel': SalesChannelCodeSchema.optional(),
});

/**
 * `?salesChannel=<code>` query parameter schema. Used by storefront SSR
 * paths and link-shareable previews; ignored on `/api/v1/admin/*` paths
 * by the resolver middleware to prevent cross-channel admin bleed.
 */
export const SalesChannelQuerySchema = z.object({
  salesChannel: SalesChannelCodeSchema.optional(),
});

// ---------------------------------------------------------------------------
// (3) Admin HTTP request/response schemas
// ---------------------------------------------------------------------------

const themeCodeRe = /^[a-z][a-z0-9_-]*$/;

/** Body shape for POST /api/v1/admin/sales-channels. */
export const SalesChannelCreateBodySchema = z
  .object({
    code: SalesChannelCodeSchema,
    name: SalesChannelNameSchema,
    logoAssetId: uuidSchema.nullable().optional(),
    themeCode: z
      .string()
      .regex(themeCodeRe, 'theme code must be lowercase machine-friendly')
      .nullable()
      .optional(),
    languages: z.array(z.string()).min(1),
    defaultLanguage: z.string(),
    currencies: z.array(z.string()).min(1),
    defaultCurrency: z.string(),
    active: z.boolean().optional().default(true),
  })
  .superRefine((v, ctx) => {
    if (!v.languages.includes(v.defaultLanguage)) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultLanguage'],
        message: 'defaultLanguage must be one of languages',
      });
    }
    if (!v.currencies.includes(v.defaultCurrency)) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultCurrency'],
        message: 'defaultCurrency must be one of currencies',
      });
    }
  });
export type SalesChannelCreateBody = z.infer<typeof SalesChannelCreateBodySchema>;

/**
 * Body shape for PATCH /api/v1/admin/sales-channels/{code}. Every field optional.
 *
 * `code` is accepted only when it repeats the channel's current code: a channel's
 * code is written once, at creation, and is immutable afterwards — on every
 * channel, not only the system default. A code is an identity other systems hold
 * onto (`SALES_CHANNEL_HOST_MAP`, cached storefront responses, integration
 * configuration), so changing it renames something those systems cannot follow.
 * A different value is refused with 422 `SALES_CHANNEL_CODE_IMMUTABLE`; the field
 * stays in the shape so the refusal is explicit rather than a silently stripped
 * property that answers 200 and changes nothing. A mistyped code is fixed by
 * creating the channel again under the right code and deleting the old one —
 * for the default channel, after moving the flag off it with `set-default`.
 * The `name` stays freely editable.
 */
export const SalesChannelUpdateBodySchema = z
  .object({
    code: SalesChannelCodeSchema.optional(),
    name: SalesChannelNameSchema.optional(),
    logoAssetId: uuidSchema.nullable().optional(),
    themeCode: z.string().regex(themeCodeRe).nullable().optional(),
    languages: z.array(z.string()).min(1).optional(),
    defaultLanguage: z.string().optional(),
    currencies: z.array(z.string()).min(1).optional(),
    defaultCurrency: z.string().optional(),
    active: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.defaultLanguage !== undefined && v.languages && !v.languages.includes(v.defaultLanguage)) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultLanguage'],
        message: 'defaultLanguage must be one of languages',
      });
    }
    if (v.defaultCurrency !== undefined && v.currencies && !v.currencies.includes(v.defaultCurrency)) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultCurrency'],
        message: 'defaultCurrency must be one of currencies',
      });
    }
  });
export type SalesChannelUpdateBody = z.infer<typeof SalesChannelUpdateBodySchema>;

/**
 * Body shape for POST /api/v1/admin/sales-channels/{code}/set-default.
 *
 * The target is the path parameter, so the body carries nothing today. It is
 * declared rather than omitted because the endpoint is a state transition, not a
 * patch: an operator's client sends `{}` and any later option (a reason, a
 * scheduled cut-over) lands here instead of on the query string.
 */
export const SalesChannelSetDefaultBodySchema = z.object({});
export type SalesChannelSetDefaultBody = z.infer<typeof SalesChannelSetDefaultBodySchema>;

/**
 * Response shape for POST /api/v1/admin/sales-channels/{code}/set-default.
 *
 * `changed` is false when the target already held the flag — promoting the
 * current default is a no-op success, not an error, so a double-click and a
 * retried request both answer 200 with the same body. `previousDefaultCode` is
 * the code that held the flag before the call, which on the no-op path is the
 * target's own code; it names the channel a subsequent `set-default` would move
 * the flag back to.
 */
export const SalesChannelSetDefaultResponseSchema = z.object({
  channel: SalesChannelDetailSchema,
  previousDefaultCode: SalesChannelCodeSchema.nullable(),
  changed: z.boolean(),
});
export type SalesChannelSetDefaultResponse = z.infer<
  typeof SalesChannelSetDefaultResponseSchema
>;

/** Response shape for GET /api/v1/admin/sales-channels (paginated list). */
export const SalesChannelListResponseSchema = z.object({
  items: z.array(SalesChannelSummarySchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type SalesChannelListResponse = z.infer<typeof SalesChannelListResponseSchema>;

// ---------------------------------------------------------------------------
// (4) Membership endpoints (bidirectional)
// ---------------------------------------------------------------------------

/** Channel-scoped entity types tracked by the M:N membership service. */
export const ChannelMemberEntityTypeSchema = z.enum([
  'product',
  'category',
  'payment-method',
  'delivery-method',
  'organization',
  'tax',
  'customer',
  'promotion',
  'cms-page',
]);
export type ChannelMemberEntityType = z.infer<typeof ChannelMemberEntityTypeSchema>;

/** `GET /api/v1/admin/sales-channels/{code}/{entityType}` — list members. */
export const ChannelMembershipListResponseSchema = z.object({
  channels: z.array(SalesChannelSummarySchema),
});
export type ChannelMembershipListResponse = z.infer<
  typeof ChannelMembershipListResponseSchema
>;

/** `GET /api/v1/admin/{entityType}/{id}/sales-channels` — list channels of an entity. */
export const EntityMembershipListResponseSchema = z.object({
  entityType: ChannelMemberEntityTypeSchema,
  entityId: uuidSchema,
  channels: z.array(SalesChannelSummarySchema),
});
export type EntityMembershipListResponse = z.infer<
  typeof EntityMembershipListResponseSchema
>;

// ---------------------------------------------------------------------------
// (5) Storefront / public read-only
// ---------------------------------------------------------------------------

/**
 * `GET /api/v1/storefront/sales-channel` — what the storefront app fetches
 * on first paint to know its theme / language / currency.
 *
 * Deliberately drops `id`, `active`, `systemDefault`, and `version`
 * (admin-only fields).
 */
export const PublicSalesChannelSchema = z.object({
  code: SalesChannelCodeSchema,
  name: SalesChannelNameSchema,
  defaultLanguage: z.string(),
  defaultCurrency: z.string(),
  languages: z.array(z.string()),
  currencies: z.array(z.string()),
  themeCode: z.string().nullable(),
  logoUrl: z.string().url().nullable(),
});
export type PublicSalesChannel = z.infer<typeof PublicSalesChannelSchema>;

// ---------------------------------------------------------------------------
// (6) Audit-action constants
// ---------------------------------------------------------------------------

/**
 * Action strings written by `SalesChannelsService` / `SalesChannelMembershipService`
 * through the existing `AuditLogService.record({ action, ... })`. They are
 * free-form strings (the audit log uses `action: string`, not an enum)
 * but every consumer should use these constants so a typo can't drift.
 */
export const SALES_CHANNEL_AUDIT_ACTIONS = {
  IDENTITY_CHANGED: 'sales_channel.identity.changed',
  MEMBERSHIP_CHANGED: 'sales_channel.membership.changed',
  LIFECYCLE_CHANGED: 'sales_channel.lifecycle.changed',
} as const;

export const SalesChannelAuditActionSchema = z.enum([
  SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED,
  SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED,
  SALES_CHANNEL_AUDIT_ACTIONS.LIFECYCLE_CHANGED,
]);
export type SalesChannelAuditAction = z.infer<typeof SalesChannelAuditActionSchema>;

export const SalesChannelLifecycleOpSchema = z.enum([
  'deactivated',
  'activated',
  'deleted',
  'system-default-promoted',
]);
export type SalesChannelLifecycleOp = z.infer<typeof SalesChannelLifecycleOpSchema>;

export const SalesChannelMembershipOpSchema = z.enum(['add', 'remove']);
export type SalesChannelMembershipOp = z.infer<typeof SalesChannelMembershipOpSchema>;
