import { z } from 'zod';
import { hookableAction } from './command-hooks.js';
import type { AddressRecord } from './addresses.js';
import { addressSnapshotSchema, isoDateTimeSchema, uuidSchema } from './common.js';
import { AdminOrganizationCreateBodySchema, normalizeTaxId } from './organizations.js';

/**
 * Related payers — `specs/182-related-payers/` (contracts/ports.md, storefront-api.md,
 * admin-api.md, data-model.md). Source of truth per Principle II.
 *
 * A buyer Organization (X) names another Organization of the store (Y) as the payer
 * of an order. The module `related_payers` owns the X → Y **link**, the **request**
 * that may create one, and two ports; `orders` owns the payer on the order
 * (`orders.ts`), `carts` the *Buying for* context (`carts.ts`).
 */

// ────────────────────────────────────────────────────────────────────────
//  Vocabularies
// ────────────────────────────────────────────────────────────────────────

/**
 * Whose commercial terms price an order paid by Y (RP-10). `buyer` — X's own price
 * lists, promotions and minimum; `payer` — Y's, resolved by naming Y to the
 * unchanged pricing engine (research R-4). Set only by an operator or the port
 * (RP-11, FR-119).
 */
export const payerCommercialTermsSchema = z.enum(['buyer', 'payer']);
export type PayerCommercialTerms = z.infer<typeof payerCommercialTermsSchema>;

/** FR-011, FR-013 — `active ⇄ inactive`, `→ revoked` terminal. */
export const relatedPayerLinkStateSchema = z.enum(['active', 'inactive', 'revoked']);
export type RelatedPayerLinkState = z.infer<typeof relatedPayerLinkStateSchema>;

/** How a link came to exist (FR-011). */
export const relatedPayerLinkOriginSchema = z.enum(['operator', 'automation', 'request', 'invitation']);
export type RelatedPayerLinkOrigin = z.infer<typeof relatedPayerLinkOriginSchema>;

/** Who revoked a link (FR-050). */
export const relatedPayerRevokedByKindSchema = z.enum(['operator', 'automation', 'buyer', 'payer']);
export type RelatedPayerRevokedByKind = z.infer<typeof relatedPayerRevokedByKindSchema>;

/** Which of Y's billing addresses the link allows, as stored (data-model §1). */
export const relatedPayerAddressScopeKindSchema = z.enum(['all', 'one']);
export type RelatedPayerAddressScopeKind = z.infer<typeof relatedPayerAddressScopeKindSchema>;

/**
 * The address scope as a write names it: every billing address of Y, or exactly
 * one. A discriminated union so a `one` without an address cannot be written.
 */
export const relatedPayerAddressScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('one'), billingAddressId: uuidSchema }),
]);
export type RelatedPayerAddressScope = z.infer<typeof relatedPayerAddressScopeSchema>;

export const relatedPayerRequestDirectionSchema = z.enum(['buyer_request', 'payer_invitation']);
export type RelatedPayerRequestDirection = z.infer<typeof relatedPayerRequestDirectionSchema>;

/**
 * FR-045 — `pending → active | rejected | expired | withdrawn`. These are the only
 * states the **sender** ever reads (FR-041): where a pending request is routed is
 * {@link relatedPayerRequestRoutingSchema}, which the sender never sees.
 */
export const relatedPayerRequestStateSchema = z.enum(['pending', 'active', 'rejected', 'expired', 'withdrawn']);
export type RelatedPayerRequestState = z.infer<typeof relatedPayerRequestStateSchema>;

/** Where a pending request waits (FR-043, FR-044). Never serialised to the sender. */
export const relatedPayerRequestRoutingSchema = z.enum(['counterparty', 'operator', 'awaiting_registration']);
export type RelatedPayerRequestRouting = z.infer<typeof relatedPayerRequestRoutingSchema>;

/** Why a request is in the operator queue (FR-023). Never serialised to the sender. */
export const relatedPayerOperatorReasonSchema = z.enum([
  'approval_mode_admin',
  'second_step',
  'no_eligible_approver',
  'no_account',
  'ambiguous_tax_id',
  'ineligible',
]);
export type RelatedPayerOperatorReason = z.infer<typeof relatedPayerOperatorReasonSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Settings (FR-003, data-model §6, research R-12)
// ────────────────────────────────────────────────────────────────────────

/**
 * `MODULE_ENABLED` is the operator's activation control (Constitution XVII,
 * platform-wide, default off — RP-1). The other six have a global value and a
 * sales-channel override; `ENABLED` is the per-channel capability switch (FR-002).
 */
export const RELATED_PAYERS_SETTING_CODES = {
  MODULE_ENABLED: 'related_payers.module_enabled',
  ENABLED: 'related_payers.enabled',
  APPROVAL_MODE: 'related_payers.approval_mode',
  UNREGISTERED_PAYER_MODE: 'related_payers.unregistered_payer_mode',
  PAYER_MAY_INVITE_BUYERS: 'related_payers.payer_may_invite_buyers',
  REQUEST_TTL_DAYS: 'related_payers.request_ttl_days',
  DAILY_REQUEST_LIMIT: 'related_payers.daily_request_limit',
  /**
   * RP-20 (a) — the time zone "today" of the daily limit starts in. There is no platform-wide
   * store time zone (the `tasks.time_zone` / `returns.time_zone` precedent), so the module holds
   * one, and reads it for the **default store** — the system-default sales channel — so every
   * channel counts the same day.
   */
  TIME_ZONE: 'related_payers.time_zone',
} as const;

/** RP-20 (a) — `related_payers.time_zone`'s default, and what a zone the runtime does not know falls back to. */
export const RELATED_PAYERS_DEFAULT_TIME_ZONE = 'Europe/Warsaw';

/** FR-003 — approval for an existing counterparty. */
export const relatedPayerApprovalModeSchema = z.enum(['payer', 'admin', 'payer_then_admin']);
export type RelatedPayerApprovalMode = z.infer<typeof relatedPayerApprovalModeSchema>;

/** FR-003, FR-044 — a payer without an account. */
export const relatedPayerUnregisteredModeSchema = z.enum(['invite', 'admin']);
export type RelatedPayerUnregisteredMode = z.infer<typeof relatedPayerUnregisteredModeSchema>;

/** Request / invitation lifetime in days. */
export const relatedPayerRequestTtlDaysSchema = z.number().int().min(1).max(365);

/** Requests plus invitations one Organization may send per day (FR-046, A-9). */
export const relatedPayerDailyRequestLimitSchema = z.number().int().min(1).max(1000);

/** The defaults of the six channel-overridable settings. */
export const RELATED_PAYERS_SETTING_DEFAULTS = {
  [RELATED_PAYERS_SETTING_CODES.ENABLED]: false,
  [RELATED_PAYERS_SETTING_CODES.APPROVAL_MODE]: 'payer',
  [RELATED_PAYERS_SETTING_CODES.UNREGISTERED_PAYER_MODE]: 'admin',
  [RELATED_PAYERS_SETTING_CODES.PAYER_MAY_INVITE_BUYERS]: true,
  [RELATED_PAYERS_SETTING_CODES.REQUEST_TTL_DAYS]: 30,
  [RELATED_PAYERS_SETTING_CODES.DAILY_REQUEST_LIMIT]: 10,
} as const satisfies Record<string, boolean | string | number>;

// ────────────────────────────────────────────────────────────────────────
//  Permissions (FR-024, data-model §7)
// ────────────────────────────────────────────────────────────────────────

/** Customer-side organization permissions (`specs/170-organization-roles/`); none is member-default. */
export const RELATED_PAYERS_ORGANIZATION_PERMISSIONS = {
  MANAGE: 'related_payers.manage',
  APPROVE: 'related_payers.approve',
  ORDER_WITH_PAYER: 'related_payers.order_with_payer',
  VIEW_PAID_ORDERS: 'related_payers.view_paid_orders',
} as const;

/** Operator permission codes. `MANAGE` covers every operator write, commercial terms included. */
export const RELATED_PAYERS_OPERATOR_PERMISSIONS = {
  READ: 'related_payers:read',
  MANAGE: 'related_payers:manage',
} as const;

// ────────────────────────────────────────────────────────────────────────
//  Bounds
// ────────────────────────────────────────────────────────────────────────

/** RFC 5321's path limit; `related_payer_requests.contact_email` is `varchar(320)`. */
export const RELATED_PAYER_CONTACT_EMAIL_MAX = 320;
/** A request comment and a rejection reason. */
export const RELATED_PAYER_COMMENT_MAX = 2000;

/**
 * An automation source label (FR-030): a code, not prose, so it is audit-safe
 * (`specs/conventions/audit-state.md`). `related_payer_links.origin_source` is
 * `varchar(64)`.
 */
export const RELATED_PAYER_SOURCE_PATTERN = /^[a-z0-9_.-]{1,64}$/;

/** A tax ID as a customer types it, normalised like an Organization's, held to 8–32. */
const relatedPayerTaxIdSchema = z.string().transform(normalizeTaxId).pipe(z.string().min(8).max(32));

const contactEmailSchema = z.string().trim().max(RELATED_PAYER_CONTACT_EMAIL_MAX).email();
const commentSchema = z.string().trim().max(RELATED_PAYER_COMMENT_MAX);
const sourceSchema = z.string().regex(RELATED_PAYER_SOURCE_PATTERN);

/**
 * `validFrom ≤ validTo` when both are set. The window is two **instants** (RP-15), compared
 * as instants — two offsets make string order meaningless. Both ends inclusive (FR-012).
 */
function refineWindow(
  value: { validFrom?: string | null | undefined; validTo?: string | null | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.validFrom && value.validTo && Date.parse(value.validFrom) > Date.parse(value.validTo)) {
    ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'validTo must not be before validFrom' });
  }
}

// ────────────────────────────────────────────────────────────────────────
//  Link (FR-010 – FR-013, data-model §1)
// ────────────────────────────────────────────────────────────────────────

/**
 * A link as the Admin UI reads it (`GET /api/v1/admin/organizations/:id/related-payers`
 * answers `{ asBuyer: Link[], asPayer: Link[] }`). Both Organizations are named so
 * one row reads the same in either list.
 */
export const relatedPayerLinkSchema = z
  .object({
    id: uuidSchema,
    buyerOrganizationId: uuidSchema,
    buyerName: z.string(),
    payerOrganizationId: uuidSchema,
    payerName: z.string(),
    /** `null` only for a payer whose tax ID can no longer be read. */
    payerTaxId: z.string().nullable(),
    /** RP-20 (d) — the buyer's, shown in the payer's list of the buyers it pays for. */
    buyerTaxId: z.string().nullable(),
    state: relatedPayerLinkStateSchema,
    addressScope: relatedPayerAddressScopeKindSchema,
    /** Set iff `addressScope = 'one'`: an address of the payer. */
    billingAddressId: uuidSchema.nullable(),
    validFrom: isoDateTimeSchema.nullable(),
    validTo: isoDateTimeSchema.nullable(),
    commercialTerms: payerCommercialTermsSchema,
    /** Spec A-4, FR-074. */
    notifyPayerOnOrders: z.boolean(),
    origin: relatedPayerLinkOriginSchema,
    /** The automation source code, for `origin = 'automation'`. */
    originSource: z.string().nullable(),
    revokedAt: isoDateTimeSchema.nullable(),
    revokedByKind: relatedPayerRevokedByKindSchema.nullable(),
    /** Optimistic lock; a `PATCH` sends it back as `If-Match`. */
    version: z.number().int().positive(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine((link, ctx) => {
    if ((link.addressScope === 'one') !== (link.billingAddressId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['billingAddressId'],
        message: 'billingAddressId is set exactly when addressScope is "one"',
      });
    }
    refineWindow(link, ctx);
  });
export type RelatedPayerLink = z.infer<typeof relatedPayerLinkSchema>;

export const adminOrganizationRelatedPayersResponseSchema = z.object({
  data: z.object({
    asBuyer: z.array(relatedPayerLinkSchema),
    asPayer: z.array(relatedPayerLinkSchema),
  }),
});
export type AdminOrganizationRelatedPayersResponse = z.infer<typeof adminOrganizationRelatedPayersResponseSchema>;

/**
 * A link as a customer reads it (FR-047): X's payers, or the buyers Y pays for.
 * Commercial terms are shown and never writable from here (FR-119).
 */
export const customerRelatedPayerLinkSchema = z.object({
  id: uuidSchema,
  /** The other side: the payer in X's list, the buyer in Y's. */
  organizationId: uuidSchema,
  name: z.string(),
  taxId: z.string().nullable(),
  state: relatedPayerLinkStateSchema,
  addressScope: relatedPayerAddressScopeKindSchema,
  billingAddressId: uuidSchema.nullable(),
  validFrom: isoDateTimeSchema.nullable(),
  validTo: isoDateTimeSchema.nullable(),
  commercialTerms: payerCommercialTermsSchema,
});
export type CustomerRelatedPayerLink = z.infer<typeof customerRelatedPayerLinkSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Admin link writes (FR-021, admin-api.md)
// ────────────────────────────────────────────────────────────────────────

/** `POST /api/v1/admin/organizations/:id/related-payers` — add an existing Organization. */
export const adminAddRelatedPayerBodySchema = z
  .strictObject({
    payerOrganizationId: uuidSchema,
    addressScope: relatedPayerAddressScopeSchema.default({ kind: 'all' }),
    validFrom: isoDateTimeSchema.nullable().optional(),
    validTo: isoDateTimeSchema.nullable().optional(),
    commercialTerms: payerCommercialTermsSchema.default('buyer'),
    notifyPayerOnOrders: z.boolean().default(false),
  })
  .superRefine(refineWindow);
export type AdminAddRelatedPayerBody = z.infer<typeof adminAddRelatedPayerBodySchema>;

/**
 * `PATCH /api/v1/admin/related-payers/links/:linkId` (with `If-Match`). A state
 * change here is `active ⇄ inactive` only; revocation is its own route.
 */
export const adminUpdateRelatedPayerLinkBodySchema = z
  .strictObject({
    addressScope: relatedPayerAddressScopeSchema.optional(),
    validFrom: isoDateTimeSchema.nullable().optional(),
    validTo: isoDateTimeSchema.nullable().optional(),
    commercialTerms: payerCommercialTermsSchema.optional(),
    notifyPayerOnOrders: z.boolean().optional(),
    state: z.enum(['active', 'inactive']).optional(),
  })
  .superRefine((body, ctx) => {
    if (Object.values(body).every((v) => v === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Nothing to change' });
    }
    refineWindow(body, ctx);
  });
export type AdminUpdateRelatedPayerLinkBody = z.infer<typeof adminUpdateRelatedPayerLinkBodySchema>;

/**
 * `POST /api/v1/admin/organizations/:id/related-payers/new-organization` (FR-021): create
 * the payer as the admin *New organization* form does — always `active`, never under a
 * parent — and link it, active, in one request. The new Organization has no billing
 * address yet, so the link allows all of them. Inviting its first user is the existing
 * members-invite route, called by the panel afterwards.
 */
export const adminCreatePayerOrganizationBodySchema = z.strictObject({
  organization: z.strictObject(
    AdminOrganizationCreateBodySchema.omit({ status: true, parentId: true, customFieldValues: true }).shape,
  ),
  link: z
    .strictObject({
      validFrom: isoDateTimeSchema.nullable().optional(),
      validTo: isoDateTimeSchema.nullable().optional(),
      commercialTerms: payerCommercialTermsSchema.default('buyer'),
      notifyPayerOnOrders: z.boolean().default(false),
    })
    .superRefine(refineWindow)
    .default({ commercialTerms: 'buyer', notifyPayerOnOrders: false }),
});
export type AdminCreatePayerOrganizationBody = z.infer<typeof adminCreatePayerOrganizationBodySchema>;
export type AdminCreatePayerOrganizationRequest = z.input<typeof adminCreatePayerOrganizationBodySchema>;

/** The reply of the new-organization route: the Organization's id and the link. */
export const adminCreatePayerOrganizationResponseSchema = z.object({
  data: z.object({ organizationId: uuidSchema, link: relatedPayerLinkSchema }),
});

// ────────────────────────────────────────────────────────────────────────
//  Events (contracts/commands-audit.md — names-only payloads)
// ────────────────────────────────────────────────────────────────────────

export const RELATED_PAYERS_EVENTS = {
  LINK_CREATED: 'related_payers.link.created.v1',
  LINK_CHANGED: 'related_payers.link.changed.v1',
  LINK_REVOKED: 'related_payers.link.revoked.v1',
  /** A request or invitation was created (FR-040); ids and codes only. */
  REQUEST_CREATED: 'related_payers.request.created.v1',
  /** A request or invitation was accepted, rejected, withdrawn or expired (FR-045). */
  REQUEST_DECIDED: 'related_payers.request.decided.v1',
} as const;

/** Payload of the two request events: ids and codes only — no tax ID, e-mail, comment or name. */
export interface RelatedPayerRequestEventV1 {
  readonly requestId: string;
  readonly direction: RelatedPayerRequestDirection;
  readonly senderOrganizationId: string;
  readonly counterpartyOrganizationId: string | null;
  readonly routing: RelatedPayerRequestRouting;
  readonly state: RelatedPayerRequestState;
  readonly salesChannelId: string;
  /** `decided.v1` on acceptance: the link created. */
  readonly linkId?: string;
}

/** Payload of the three link events: ids and codes only. */
export interface RelatedPayerLinkEventV1 {
  readonly linkId: string;
  readonly buyerOrganizationId: string;
  readonly payerOrganizationId: string;
  readonly state: RelatedPayerLinkState;
  readonly commercialTerms: PayerCommercialTerms;
  /** `link.changed.v1` only: the sorted names of what changed. */
  readonly changedFields?: readonly string[];
}

// ────────────────────────────────────────────────────────────────────────
//  Requests and invitations (FR-040 – FR-047, storefront-api.md, research R-8)
// ────────────────────────────────────────────────────────────────────────

/**
 * `POST /api/v1/account/related-payers/requests` and
 * `POST /api/v1/account/payees/invitations`. Strict: a customer names no
 * counterparty, routing or commercial terms (FR-041, FR-119).
 */
export const createRelatedPayerRequestBodySchema = z.strictObject({
  taxId: relatedPayerTaxIdSchema,
  contactEmail: contactEmailSchema,
  comment: commentSchema.optional(),
});
export type CreateRelatedPayerRequestBody = z.infer<typeof createRelatedPayerRequestBodySchema>;

/**
 * The **one** reply to a request or an invitation, whatever the tax-ID lookup found
 * (FR-041): the sender's own row id, which leaks nothing, and `pending`. `202`.
 */
export const relatedPayerAcceptedRequestResponseSchema = z.object({
  data: z.object({ id: uuidSchema, state: z.literal('pending') }),
});
export type RelatedPayerAcceptedRequestResponse = z.infer<typeof relatedPayerAcceptedRequestResponseSchema>;

/**
 * A request as its **sender** reads it (FR-041). Deliberately without
 * `counterpartyOrganizationId`, `routing` and `operatorReason`: a parse drops them
 * if a serialiser ever hands them over.
 */
export const relatedPayerSentRequestSchema = z.object({
  id: uuidSchema,
  direction: relatedPayerRequestDirectionSchema,
  /** The tax ID as entered, normalised. */
  taxId: z.string(),
  contactEmail: z.string(),
  comment: z.string().nullable(),
  state: relatedPayerRequestStateSchema,
  /** Shown to the sender on a rejection (FR-045). */
  rejectionReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  decidedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema,
});
export type RelatedPayerSentRequest = z.infer<typeof relatedPayerSentRequestSchema>;

/** A request as its **counterparty** reads it (`GET /api/v1/account/related-payers/incoming`). */
export const relatedPayerIncomingRequestSchema = z.object({
  id: uuidSchema,
  direction: relatedPayerRequestDirectionSchema,
  senderOrganizationId: uuidSchema,
  senderName: z.string(),
  senderTaxId: z.string().nullable(),
  comment: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
});
export type RelatedPayerIncomingRequest = z.infer<typeof relatedPayerIncomingRequestSchema>;

/** Rejection by the counterparty (optional reason) — strict, so it cannot carry terms. */
export const rejectRelatedPayerRequestBodySchema = z.strictObject({
  reason: commentSchema.optional(),
});
export type RejectRelatedPayerRequestBody = z.infer<typeof rejectRelatedPayerRequestBodySchema>;

/** One row of the operator queue (FR-023): everything, including what the sender never sees. */
export const adminRelatedPayerRequestSchema = relatedPayerSentRequestSchema.extend({
  senderOrganizationId: uuidSchema,
  senderName: z.string(),
  counterpartyOrganizationId: uuidSchema.nullable(),
  counterpartyName: z.string().nullable(),
  routing: relatedPayerRequestRoutingSchema,
  operatorReason: relatedPayerOperatorReasonSchema.nullable(),
  approvalMode: relatedPayerApprovalModeSchema,
  unregisteredMode: relatedPayerUnregisteredModeSchema,
  salesChannelId: uuidSchema,
  counterpartyAcceptedAt: isoDateTimeSchema.nullable(),
  /** For `ambiguous_tax_id`: the Organizations the tax ID matched. */
  candidates: z.array(z.object({ organizationId: uuidSchema, name: z.string() })),
});
export type AdminRelatedPayerRequest = z.infer<typeof adminRelatedPayerRequestSchema>;

/** `POST /api/v1/admin/related-payers/requests/:id/reject` — the reason is shown to the sender. */
export const adminRejectRelatedPayerRequestBodySchema = z.strictObject({
  reason: commentSchema.pipe(z.string().min(1)),
});
export type AdminRejectRelatedPayerRequestBody = z.infer<typeof adminRejectRelatedPayerRequestBodySchema>;

/**
 * `POST /api/v1/admin/related-payers/requests/:id/create-organization` (FR-023, US5-2): the
 * counterparty a request names has no account, and the operator creates it as the card's create
 * does — always `active`, never under a parent, the tax ID the request named. The request's link is
 * then created on the buyer's terms (RP-11): the body names no terms.
 */
export const adminCreateRequestOrganizationBodySchema = z.strictObject({
  organization: z.strictObject(
    AdminOrganizationCreateBodySchema.omit({ status: true, parentId: true, customFieldValues: true }).shape,
  ),
});
export type AdminCreateRequestOrganizationBody = z.infer<typeof adminCreateRequestOrganizationBodySchema>;
export type AdminCreateRequestOrganizationRequest = z.input<typeof adminCreateRequestOrganizationBodySchema>;

/** The reply of the queue's create-organization action: the new Organization and the link. */
export const adminCreateRequestOrganizationResponseSchema = z.object({
  data: z.object({ id: uuidSchema, state: z.literal('active'), organizationId: uuidSchema, linkId: uuidSchema }),
});

/**
 * `GET /api/v1/related-payers/invitations/:token` (FR-044, T092) — anonymous: the registration form
 * pre-fills the tax ID an invitation to register named. `404` for a token that is unknown, used up
 * or expired — the form then starts empty.
 */
export const relatedPayerInvitationLookupResponseSchema = z.object({
  data: z.object({ taxId: z.string() }),
});
export type RelatedPayerInvitationLookupResponse = z.infer<typeof relatedPayerInvitationLookupResponseSchema>;

/**
 * `GET /api/v1/related-payers/availability` (FR-002) — a signed-in customer's read of whether the
 * capability is on for the request's channel, so the storefront offers *Payers* and *Orders we
 * pay for* only where their routes answer (the `returns` guest `availability` precedent). `200`
 * either way; `503 MODULE_DISABLED` while the module is off. Never cached.
 */
export const relatedPayersAvailabilityResponseSchema = z.object({
  data: z.object({ enabled: z.boolean() }),
});
export type RelatedPayersAvailabilityResponse = z.infer<typeof relatedPayersAvailabilityResponseSchema>;

/** `POST /api/v1/admin/related-payers/requests/:id/assign-organization` — ambiguous tax ID. */
export const adminAssignRelatedPayerOrganizationBodySchema = z.strictObject({
  organizationId: uuidSchema,
});
export type AdminAssignRelatedPayerOrganizationBody = z.infer<typeof adminAssignRelatedPayerOrganizationBodySchema>;

// ────────────────────────────────────────────────────────────────────────
//  Checkout (FR-060, storefront-api.md `GET /api/v1/checkout/payers`)
// ────────────────────────────────────────────────────────────────────────

export const checkoutPayerSchema = z.object({
  payerOrganizationId: uuidSchema,
  name: z.string(),
  taxId: z.string(),
  commercialTerms: payerCommercialTermsSchema,
  /** The link's allowed ∩ the payer's live billing addresses. */
  billingAddresses: z.array(addressSnapshotSchema.extend({ id: uuidSchema })),
  /**
   * The payer's payment-method allow-list (FR-066); the buyer's list does not narrow it.
   * `null` — the payer is not restricted. The methods themselves, filtered for the payer,
   * are `GET /api/v1/payment-methods?payerOrganizationId=`.
   */
  paymentMethodIds: z.array(uuidSchema).nullable(),
  /**
   * RP-16 (c) — the payer's available credit (its grant, under the inheritance rule, less its
   * active reservations), as `GET /api/v1/me/credit-limit` answers the payer itself; `null`
   * without a grant or while `credit_limits` is absent. The checkout offers the credit-limit
   * method for the payer by the rule it applies to the buyer's own credit.
   */
  creditAvailable: z.number().finite().nullable(),
});
export type CheckoutPayer = z.infer<typeof checkoutPayerSchema>;

export const checkoutPayersResponseSchema = z.object({ data: z.array(checkoutPayerSchema) });
export type CheckoutPayersResponse = z.infer<typeof checkoutPayersResponseSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Ports (contracts/ports.md §1, §2)
// ────────────────────────────────────────────────────────────────────────

/** Who is asking the policy port — never taken from a request body. */
export interface PayerPolicySubject {
  /** From the session / cart. */
  buyerOrganizationId: string;
  /** The person acting. */
  customerAccountId: string;
  /** The request's resolved channel. */
  salesChannelId: string;
}

export interface UsablePayer {
  linkId: string;
  payerOrganizationId: string;
  payerName: string;
  payerTaxId: string;
  commercialTerms: PayerCommercialTerms;
  /** The link's allowed ∩ the payer's live billing addresses. */
  billingAddressIds: readonly string[];
}

/**
 * Container name: `relatedPayerPolicyPort`. Owner: `related_payers`. Consumers:
 * `orders` and `payment_methods` (`refuses-without`), `carts` (`degrades-without`).
 *
 * **Owner off:** resolving the port throws `ModuleDisabledError` (`503
 * MODULE_DISABLED`); `orders` refuses a placement naming a payer, `carts` prices
 * for the buyer's own Organization.
 */
export interface RelatedPayerPolicyPort {
  /**
   * Payers this person may order with now (FR-012 ∧ the person holds
   * `related_payers.order_with_payer`). Empty when the capability is off on the channel.
   */
  usablePayers(subject: PayerPolicySubject): Promise<readonly UsablePayer[]>;
  /** Throws 422 `RELATED_PAYER_NOT_USABLE` when not usable; runs on the caller's transaction when given. */
  assertUsable(
    subject: PayerPolicySubject,
    payerOrganizationId: string,
    opts?: { tx?: unknown; billingAddressId?: string },
  ): Promise<UsablePayer>;
  /** Y's allowed billing addresses, read under system scope after the link check (research R-5). */
  payerBillingAddresses(subject: PayerPolicySubject, payerOrganizationId: string): Promise<readonly AddressRecord[]>;
  /** The pricing subject for a cart in a payer's-terms context, or `null` (research R-4). */
  pricingContext(
    subject: PayerPolicySubject,
    payerOrganizationId: string,
  ): Promise<{ organizationId: string; customerGroupId: string | null } | null>;
  /** Cache-only, no database read: does the buyer hold any payer's-terms link at all? */
  hasPayerTermsLinks(buyerOrganizationId: string, salesChannelId: string): Promise<boolean>;
}

/** `RelatedPayerWritePort.addPayer`'s input, validated by the port (FR-030, FR-031). */
export const addPayerInputSchema = z
  .object({
    buyerOrganizationId: uuidSchema,
    payerOrganizationId: uuidSchema,
    source: sourceSchema,
    addressScope: relatedPayerAddressScopeSchema.optional(),
    validFrom: isoDateTimeSchema.nullable().optional(),
    validTo: isoDateTimeSchema.nullable().optional(),
    /** RP-11: allowed here. */
    commercialTerms: payerCommercialTermsSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.buyerOrganizationId === input.payerOrganizationId) {
      ctx.addIssue({
        code: 'custom',
        path: ['payerOrganizationId'],
        message: 'A payer link connects two different Organizations',
      });
    }
    refineWindow(input, ctx);
  });
export type AddPayerInput = z.input<typeof addPayerInputSchema>;

export const revokePayerInputSchema = z.object({
  buyerOrganizationId: uuidSchema,
  payerOrganizationId: uuidSchema,
  source: sourceSchema,
});
export type RevokePayerInput = z.infer<typeof revokePayerInputSchema>;

/**
 * Container name: `relatedPayerWritePort`. Owner: `related_payers`. Consumers:
 * deployment overlays (FR-030). Each call is one Command with actor kind
 * `automation` and `origin_source = source`.
 *
 * **Owner off:** resolving the port throws `ModuleDisabledError` (`503
 * MODULE_DISABLED`) and nothing is written (FR-032).
 */
export interface RelatedPayerWritePort {
  /** Idempotent on an active link: answers it unchanged (`{ created: false }`). Refuses FR-010 violations with 422. */
  addPayer(input: AddPayerInput): Promise<{ linkId: string; created: boolean }>;
  /** Revokes the non-revoked link of the pair; `{ revoked: false }` when there is none. */
  revokePayer(input: RevokePayerInput): Promise<{ revoked: boolean }>;
}

// ────────────────────────────────────────────────────────────────────────
//  Lists (storefront-api.md, admin-api.md)
// ────────────────────────────────────────────────────────────────────────

/** `GET /api/v1/account/related-payers` (X's payers) and `GET /api/v1/account/payees` (Y's buyers). */
export const customerRelatedPayerLinksResponseSchema = z.object({ data: z.array(customerRelatedPayerLinkSchema) });
export type CustomerRelatedPayerLinksResponse = z.infer<typeof customerRelatedPayerLinksResponseSchema>;

/** `GET /api/v1/account/related-payers/requests` — the sender's view (FR-041). */
export const relatedPayerSentRequestsResponseSchema = z.object({ data: z.array(relatedPayerSentRequestSchema) });
export type RelatedPayerSentRequestsResponse = z.infer<typeof relatedPayerSentRequestsResponseSchema>;

/** `GET /api/v1/account/related-payers/incoming` — the counterparty's view (FR-047). */
export const relatedPayerIncomingRequestsResponseSchema = z.object({ data: z.array(relatedPayerIncomingRequestSchema) });
export type RelatedPayerIncomingRequestsResponse = z.infer<typeof relatedPayerIncomingRequestsResponseSchema>;

/** The largest page the operator queue serves (UX audit DS-05, #1439). */
export const ADMIN_RELATED_PAYER_REQUESTS_MAX_PAGE_SIZE = 200;

/**
 * `GET /api/v1/admin/related-payers/requests` — the operator queue (FR-023), oldest first. `page`
 * is one-based; without a `pageSize` the queue answers its first 500 entries, as it did before it
 * was paged (UX audit DS-05, #1439).
 */
export const adminRelatedPayerRequestsQuerySchema = z.strictObject({
  /** Default `pending`: what waits for the operator. */
  state: relatedPayerRequestStateSchema.optional(),
  reason: relatedPayerOperatorReasonSchema.optional(),
  salesChannelId: uuidSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(ADMIN_RELATED_PAYER_REQUESTS_MAX_PAGE_SIZE).optional(),
});
export type AdminRelatedPayerRequestsQuery = z.infer<typeof adminRelatedPayerRequestsQuerySchema>;
/** What a caller sends: `page` may be left out. */
export type AdminRelatedPayerRequestsQueryInput = z.input<typeof adminRelatedPayerRequestsQuerySchema>;
/** One page of the queue, and `meta.total` across every page — the Organizations list's shape. */
export const adminRelatedPayerRequestsResponseSchema = z.object({
  data: z.array(adminRelatedPayerRequestSchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
export type AdminRelatedPayerRequestsResponse = z.infer<typeof adminRelatedPayerRequestsResponseSchema>;

// ────────────────────────────────────────────────────────────────────────
//  Hookable actions — the after-commit outbox (research R-8, `specs/176-command-hooks-outbox/`)
// ────────────────────────────────────────────────────────────────────────

/**
 * `afterCommit` data of the request Commands: ids and codes only (audit-state list 1). The reply
 * to a sender never waits on, or varies with, what the request's routing sends (FR-041): every
 * e-mail, in-account entry and operator bell entry is delivered from this outbox, after commit.
 */
export type RelatedPayerRequestOutbox = {
  readonly requestId: string;
  readonly direction: RelatedPayerRequestDirection;
  readonly routing: RelatedPayerRequestRouting;
  readonly state: RelatedPayerRequestState;
  /** The sender — the row's tenant. */
  readonly organizationId: string;
};

/** `afterCommit` data of `related_payers.link.revoke` (FR-050): who revoked, by kind. */
export type RelatedPayerLinkRevokedOutbox = {
  readonly linkId: string;
  readonly revokedByKind: RelatedPayerRevokedByKind;
  readonly payerOrganizationId: string;
  /** The buyer — the row's tenant. */
  readonly organizationId: string;
};

/**
 * The `related_payers` Commands whose after-commit work runs through the outbox. The module
 * registers its own notification handlers on them; an instance may add its own.
 */
export const RELATED_PAYERS_HOOKABLE_ACTIONS = {
  requestCreate: hookableAction<never, RelatedPayerRequestOutbox>('related_payers.request.create', 'related_payer_request', [
    'afterCommit',
  ]),
  requestAccept: hookableAction<never, RelatedPayerRequestOutbox>('related_payers.request.accept', 'related_payer_request', [
    'afterCommit',
  ]),
  requestReject: hookableAction<never, RelatedPayerRequestOutbox>('related_payers.request.reject', 'related_payer_request', [
    'afterCommit',
  ]),
  linkRevoke: hookableAction<never, RelatedPayerLinkRevokedOutbox>('related_payers.link.revoke', 'related_payer_link', [
    'afterCommit',
  ]),
  /** RP-20 (c) — an expired request tells its requester, from this outbox like every other notice. */
  requestExpire: hookableAction<never, RelatedPayerRequestOutbox>('related_payers.request.expire', 'related_payer_request', [
    'afterCommit',
  ]),
  /**
   * US5 (FR-023, FR-044) — a request routed to an Organization after it was created: the operator
   * assigned one, or one registered with the tax ID and was approved. Told like a new request.
   */
  requestRoute: hookableAction<never, RelatedPayerRequestOutbox>('related_payers.request.route', 'related_payer_request', [
    'afterCommit',
  ]),
} as const;
