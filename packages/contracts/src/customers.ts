import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { organizationRoleRefSchema } from './organization-roles.js';

/**
 * Customers (Klienci) module — feature 040.
 *
 * Boundary schemas for the customer-lifecycle surfaces: standalone
 * registration, the self-service address book + defaults, and the admin
 * customer list / detail. The `CustomerAccount` record itself is owned by
 * the `customer_accounts` module; these schemas describe the HTTP contract
 * the `customers` module exposes on top of it.
 */

// ── Primitives ────────────────────────────────────────────────────────────

export const customerAddressKindSchema = z.enum(['delivery', 'billing']);
export type CustomerAddressKind = z.infer<typeof customerAddressKindSchema>;

export const customerBlockSourceSchema = z.enum(['staff', 'org_owner']);
export type CustomerBlockSource = z.infer<typeof customerBlockSourceSchema>;

/**
 * The codes a redacted `customer_address` audit row keeps (issue #844) — the
 * legacy personal address book's rows (`specs/173-b2c-address-book-merge/`).
 *
 * Owner: `customers`; **codes only** — see `CUSTOMER_ACCOUNT_AUDIT_KEEP_KEYS`
 * for the rule they extend. `mergeRefusal` is the code a refused merge into the
 * Organization book records; `countryCode` is kept as the address scrub keeps
 * the country.
 */
export const CUSTOMER_ADDRESS_AUDIT_KEEP_KEYS: readonly string[] = ['countryCode', 'mergeRefusal'];

export const customerLifecycleStatusSchema = z.enum([
  'active',
  'blocked',
  'deleted',
]);
export type CustomerLifecycleStatus = z.infer<
  typeof customerLifecycleStatusSchema
>;

// ── Addresses ─────────────────────────────────────────────────────────────
//
// `specs/173-b2c-address-book-merge/` release 1 retired the personal address
// book for everyone: its routes answer `410 CUSTOMER_ADDRESS_BOOK_RETIRED`, and
// every customer's one book is their Organization's (`organizations.ts` owns
// those shapes). What is left here is the admin card's read, which lists the
// rows the release-1 retirement job refused. Release 2 removes it with the
// table.

export const customerAddressSchema = z.object({
  id: uuidSchema,
  customerAccountId: uuidSchema,
  kind: customerAddressKindSchema,
  recipientName: z.string(),
  street: z.string(),
  city: z.string(),
  postalCode: z.string(),
  country: z.string(),
  phone: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  /**
   * Why the release-1 retirement job could not move this row into the
   * Organization book — the owner's error code, for example
   * `DICTIONARY_ENTRY_INACTIVE`. Present on the admin card's refused rows.
   */
  mergeRefusal: z.string().nullable().optional(),
});
export type CustomerAddress = z.infer<typeof customerAddressSchema>;

/**
 * An organization-owned address (subset of the `addresses` module shape)
 * exposed read-only so an org-bound customer can pick from the shared pool.
 */
export const organizationAddressRefSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  kind: customerAddressKindSchema,
  recipientName: z.string(),
  street: z.string(),
  city: z.string(),
  postalCode: z.string(),
  country: z.string(),
  phone: z.string().nullable(),
  isDefault: z.boolean(),
});
export type OrganizationAddressRef = z.infer<
  typeof organizationAddressRefSchema
>;

/**
 * `GET /api/v1/admin/customers/:id/addresses` — the admin card (OD-6): the
 * customer's Organization book, read-only, and under `personal` only the
 * personal-book rows the retirement job refused, each with its `mergeRefusal`.
 */
export const customerAddressBookSchema = z.object({
  personal: z.array(customerAddressSchema),
  organization: z.array(organizationAddressRefSchema),
});
export type CustomerAddressBook = z.infer<typeof customerAddressBookSchema>;

// ── Defaults ──────────────────────────────────────────────────────────────

export const customerDefaultsSchema = z.object({
  paymentMethodId: uuidSchema.nullable(),
  deliveryMethodId: uuidSchema.nullable(),
  billingAddressId: uuidSchema.nullable(),
  shippingAddressId: uuidSchema.nullable(),
});
export type CustomerDefaults = z.infer<typeof customerDefaultsSchema>;

export const updateCustomerDefaultsRequestSchema = z.object({
  paymentMethodId: uuidSchema.nullable().optional(),
  deliveryMethodId: uuidSchema.nullable().optional(),
  billingAddressId: uuidSchema.nullable().optional(),
  shippingAddressId: uuidSchema.nullable().optional(),
});
export type UpdateCustomerDefaultsRequest = z.infer<
  typeof updateCustomerDefaultsRequestSchema
>;

// ── Self-service registration & profile ───────────────────────────────────

export const customerRegisterRequestSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(256),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  acceptedTermsVersion: z.string().min(1).max(64),
});
export type CustomerRegisterRequest = z.infer<
  typeof customerRegisterRequestSchema
>;

/**
 * `GET /api/v1/storefront/settings/customer-registration` — whether the
 * storefront may offer individual (org-less) self-registration (issue #756).
 * It is the answer `POST /api/v1/customers/register` applies, read before the
 * form is rendered rather than after it is submitted.
 */
export const customerRegistrationOptionsResponseSchema = z.object({
  data: z.object({
    /** `customers.allow_registration_without_organization`. */
    allowRegistrationWithoutOrganization: z.boolean(),
  }),
});
export type CustomerRegistrationOptionsResponse = z.infer<
  typeof customerRegistrationOptionsResponseSchema
>;

export const customerSelfProfileSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  organizationId: uuidSchema.nullable(),
  customerGroupId: uuidSchema.nullable(),
  twoFactorEnabled: z.boolean(),
  /**
   * Issue #652 (D-292) — the language the account's e-mails are written in, as
   * the channel that captured it spells it; `null` while unknown. See
   * `CustomerAccountRecord.preferredLanguage`.
   */
  preferredLanguage: z.string().nullable(),
  /** The member's role (`specs/170-organization-roles/` FR-056); it replaced the legacy `role`. */
  organizationRole: organizationRoleRefSchema,
  /** The member's effective organization permissions, sorted (FR-056). */
  permissions: z.array(z.string()),
});
export type CustomerSelfProfile = z.infer<typeof customerSelfProfileSchema>;

/**
 * The longest language tag a preferred language may be — RFC 5646 §4.4.1's
 * recommended minimum buffer, and the width of `customer_accounts.preferred_language`.
 */
export const CUSTOMER_PREFERRED_LANGUAGE_MAX_LENGTH = 35;

/**
 * A BCP-47 tag's shape: a two- or three-letter primary subtag, then hyphenated
 * subtags of one to eight letters or digits. The shape, not the registry — the
 * route checks the tag against the request channel's own languages.
 */
const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

/**
 * `PATCH /api/v1/me/customer/preferred-language` — the buyer's explicit choice
 * of the language their e-mails are written in (issue #652, D-292). Not
 * nullable: the account page always submits a language. A tag the request's
 * sales channel does not offer is refused `422 PREFERRED_LANGUAGE_NOT_OFFERED`;
 * an offered one is stored in the channel's spelling, matched
 * case-insensitively.
 */
export const patchCustomerPreferredLanguageBodySchema = z.object({
  preferredLanguage: z
    .string()
    .trim()
    .max(CUSTOMER_PREFERRED_LANGUAGE_MAX_LENGTH)
    .regex(LANGUAGE_TAG_SHAPE),
});
export type PatchCustomerPreferredLanguageBody = z.infer<typeof patchCustomerPreferredLanguageBodySchema>;

export const patchCustomerPreferredLanguageResponseSchema = z.object({
  data: z.object({ preferredLanguage: z.string() }),
});
export type PatchCustomerPreferredLanguageResponse = z.infer<
  typeof patchCustomerPreferredLanguageResponseSchema
>;

// Password change reuses `changePasswordRequestSchema` from organizations.ts.

// ── Admin: list & detail ──────────────────────────────────────────────────

export const adminCustomerListItemSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  organizationId: uuidSchema.nullable(),
  organizationName: z.string().nullable(),
  customerGroupId: uuidSchema.nullable(),
  customerGroupName: z.string().nullable(),
  blocked: z.boolean(),
  deleted: z.boolean(),
  createdAt: isoDateTimeSchema,
  lastLoginAt: isoDateTimeSchema.nullable(),
});
export type AdminCustomerListItem = z.infer<typeof adminCustomerListItemSchema>;

/**
 * `GET /api/v1/admin/customers` — one page of the admin list (issue #599).
 * Offset paging: `page` is 1-based, `pageSize` 1–100, `total` the rows the
 * filters match across every page.
 */
export const adminCustomerListResponseSchema = z.object({
  data: z.array(adminCustomerListItemSchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
export type AdminCustomerListResponse = z.infer<typeof adminCustomerListResponseSchema>;

export const adminCustomerBlockInfoSchema = z.object({
  blockedAt: isoDateTimeSchema,
  blockSource: customerBlockSourceSchema,
  blockReason: z.string().nullable(),
  blockedByAdminUserId: uuidSchema.nullable(),
  blockedByCustomerAccountId: uuidSchema.nullable(),
});
export type AdminCustomerBlockInfo = z.infer<
  typeof adminCustomerBlockInfoSchema
>;

export const adminCustomerDeletionInfoSchema = z.object({
  deletedAt: isoDateTimeSchema,
  anonymizedAt: isoDateTimeSchema.nullable(),
  restorableUntil: isoDateTimeSchema.nullable(),
});
export type AdminCustomerDeletionInfo = z.infer<
  typeof adminCustomerDeletionInfoSchema
>;

export const adminCustomerDetailSchema = adminCustomerListItemSchema.extend({
  block: adminCustomerBlockInfoSchema.nullable(),
  deletion: adminCustomerDeletionInfoSchema.nullable(),
  emailVerifiedAt: isoDateTimeSchema.nullable(),
  twoFactorEnabled: z.boolean(),
  /**
   * Issue #652 (D-292) — the customer's e-mail language, shown read-only to
   * staff; `null` while unknown (the store's default language is used).
   */
  preferredLanguage: z.string().nullable(),
  salesChannelIds: z.array(uuidSchema),
  defaults: customerDefaultsSchema,
  /** Feature 055 — custom-field values captured on this customer. */
  customFieldValues: z.record(z.string(), z.unknown()).default({}),
});
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;

// ── Admin: mutations ──────────────────────────────────────────────────────

export const blockCustomerRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
});
export type BlockCustomerRequest = z.infer<typeof blockCustomerRequestSchema>;

export const assignOrganizationRequestSchema = z.object({
  organizationId: uuidSchema,
});
export type AssignOrganizationRequest = z.infer<
  typeof assignOrganizationRequestSchema
>;

export const assignCustomerGroupRequestSchema = z.object({
  customerGroupId: uuidSchema.nullable(),
});
export type AssignCustomerGroupRequest = z.infer<
  typeof assignCustomerGroupRequestSchema
>;

export const validateCustomerVatRequestSchema = z.object({
  taxId: z.string().min(4).max(32),
  countryCode: z.string().length(2).optional(),
});
export type ValidateCustomerVatRequest = z.infer<
  typeof validateCustomerVatRequestSchema
>;

export const startImpersonationRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
});
export type StartImpersonationRequest = z.infer<
  typeof startImpersonationRequestSchema
>;

// ── Admin: presence ───────────────────────────────────────────────────────

export const onlineCustomerSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  lastSeenAt: isoDateTimeSchema,
});
export type OnlineCustomer = z.infer<typeof onlineCustomerSchema>;
