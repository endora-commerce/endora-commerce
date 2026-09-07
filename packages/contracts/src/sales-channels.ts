// Sales Channels module — feature 005 contract surface.
// Single file with logical sections (matching the convention used by every
// other module in @endora-commerce/contracts):
//   (1) Identity primitives (channel code, summary, detail).
//   (2) Resolver middleware contract (header / query schemas).
//   (3) Admin HTTP request/response schemas (list / detail / create / edit
//       / lifecycle).
//   (4) Membership endpoints (the bidirectional channel-side / entity-side
//       routes; one shape, used by all 10 entity types).
//   (5) Storefront / public read-only schemas.
//   (6) Audit-action constants — free-form action strings written through
//       the existing AuditLogService.
//   (7) Attribution registry — the contribution seam that answers "who still
//       points at this channel?" before a delete (feature 075, D-87).
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

/** Response envelope of `GET /api/v1/storefront/sales-channel`. */
export const PublicSalesChannelResponseSchema = z.object({
  data: PublicSalesChannelSchema,
});
export type PublicSalesChannelResponse = z.infer<typeof PublicSalesChannelResponseSchema>;

/**
 * **The platform no longer holds a list of storefront themes** — owner ruling
 * D-199, implemented by `specs/102-storefront-theme-discovery/`.
 *
 * `STOREFRONT_THEME_CODES`, `StorefrontThemeCodeSchema`, `StorefrontThemeCode`,
 * `DEFAULT_STOREFRONT_THEME_CODE` and `isStorefrontThemeCode` used to live here
 * and are gone. A theme is a token set a **third party** may publish as an
 * ordinary npm package, so no set this repository can compile is the whole set:
 * the answer belongs to the storefront instance that has the packages
 * installed, and it is generated in that instance's own tree
 * (`storefront/lib/theme/`).
 *
 * The **write** schemas above are unchanged and must stay so. They have never
 * used the enum: `themeCodeRe` is the whole validation, and a backend that
 * refused a code it has never heard of would make the field unusable for
 * exactly the deployments it exists for. `PublicSalesChannelSchema.themeCode`
 * is likewise unchanged — the wire shape gains and loses nothing.
 *
 * What an unknown code does is the storefront's answer and is unchanged too:
 * it renders the instance's default rather than blank, reports the code once
 * per process, marks the document with `data-theme-requested`, never writes the
 * value back and never guesses at a near match. See
 * `specs/102-storefront-theme-discovery/contracts/theme-package.md` for what a
 * theme author ships, and `contracts/instance-theme-registry.md` for how an
 * instance discovers its own.
 */

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

// ---------------------------------------------------------------------------
// (7) Attribution registry — "who still points at this sales channel?"
//     (feature 075, D-87 drain).
// ---------------------------------------------------------------------------

/**
 * One consumer's answer about one sales channel.
 *
 * The four descriptive fields are what the refusal message shows the operator,
 * and `ownerModuleId` is what attributes a refused delete to a module.
 */
export interface SalesChannelAttribution {
  ownerModuleId: string;
  /** Operator-facing name of the attributing record set, e.g. `orders`. */
  consumer: string;
  /** The consumer's own table holding the attribution. */
  tableName: string;
  /** The column holding the channel id. */
  columnName: string;
  count: number;
}

/**
 * One contributed "who is attributed to this channel" counter.
 *
 * A module that records the sales channel a transaction happened on registers
 * one of these per column it records it in, from its own `ctx.onBoot`. It
 * queries its **own** tables and nothing else — which is the whole point:
 * before this existed, `SalesChannelsService.delete` hand-wrote one statement
 * naming `orders` and `quote_requests`, two other modules' tables, invisible to
 * the import-level boundary check because raw SQL names no specifier (D-87).
 *
 * A read port would have been the wrong repair, and the manifests say why.
 * `sales_channels` declares `activation.nonDeactivatable`, and the lifecycle
 * refuses to disable a module a non-deactivatable one depends on — so a
 * `dependencies` entry onto `quote_requests`, which is switchable, would have
 * taken the operator's RFQ switch away in order to count rows before a channel
 * delete. It is also the direction MR !771 found was the defect: an edge from
 * the thing being pointed at towards the things pointing at it.
 *
 * `ownerModuleId` is required and is the whole mechanism (D-39): without it the
 * registry could not state a policy for an absent owner at all.
 */
export interface SalesChannelAttributionDescriptor {
  ownerModuleId: string;
  consumer: string;
  tableName: string;
  columnName: string;
  /**
   * How many of this consumer's rows are attributed to `salesChannelId`. Asked
   * immediately before a delete, so it must be a point query the consumer's own
   * indexes can serve.
   */
  countForChannel(salesChannelId: string): Promise<number>;
}

/**
 * Container name: `salesChannelAttributionRegistry`. Owner: `sales_channels`.
 *
 * A **contribution seam**: contributors push from a boot hook and read nothing
 * back, so the registration is a plain `ctx.di.register` rather than a
 * `providePort` — a boot hook that resolved a gate would stop the backend from
 * starting whenever the registry's owner was switched off. The owner is
 * `nonDeactivatable` today, which is why no reader here degrades.
 *
 * **Enumeration policy: honoured while the contributing module is absent.**
 * D-39's default is to skip, and honouring needs a written reason: this is
 * referential integrity, not a surface — the same ground
 * `DictionaryReferenceRegistryPort` states for the same shape. If
 * `quote_requests` is switched off its requests still exist and are still
 * attributed to a channel; skipping its descriptor would let an operator delete
 * the channel underneath them and get the dangling attribution back the moment
 * the module is switched on again — data loss caused by an action Constitution
 * XVII promises is non-destructive and reversible. Nobody sees a descriptor;
 * they exist to refuse a delete.
 *
 * Honouring is also the only policy the database agrees with:
 * `quote_requests_sales_channel_fk` is `on delete restrict`, so a skipped
 * descriptor does not make the delete succeed — it turns a 422 naming the
 * module into a raw constraint violation. `orders.sales_channel_id` carries no
 * foreign key at all, so there a skip would orphan the rows outright.
 */
export interface SalesChannelAttributionRegistryPort {
  register(descriptor: SalesChannelAttributionDescriptor): void;
  /** The contributing module of every registered descriptor, in registration order. */
  owners(): readonly string[];
  /** Every attribution pointing at one channel, across all descriptors. Zero counts dropped. */
  countForChannel(salesChannelId: string): Promise<SalesChannelAttribution[]>;
}
