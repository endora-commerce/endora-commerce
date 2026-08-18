import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

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

export const customerLifecycleStatusSchema = z.enum([
  'active',
  'blocked',
  'deleted',
]);
export type CustomerLifecycleStatus = z.infer<
  typeof customerLifecycleStatusSchema
>;

// ── Addresses ─────────────────────────────────────────────────────────────

export const customerAddressInputSchema = z.object({
  kind: customerAddressKindSchema,
  recipientName: z.string().min(1).max(160),
  street: z.string().min(1).max(255),
  city: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(20),
  country: z.string().length(2),
  phone: z.string().max(32).optional(),
  isDefault: z.boolean().optional(),
});
export type CustomerAddressInput = z.infer<typeof customerAddressInputSchema>;

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

export const customerSelfProfileSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  organizationId: uuidSchema.nullable(),
  customerGroupId: uuidSchema.nullable(),
  twoFactorEnabled: z.boolean(),
});
export type CustomerSelfProfile = z.infer<typeof customerSelfProfileSchema>;

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

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `customers` publishes (feature 075, Phase P). One
// cross-module consumer: `quick_order` resolves a buyer's saved personal
// address when it fills in their one-click defaults.
// ---------------------------------------------------------------------------

/**
 * A customer's own saved address — never the ORM entity (FR-011).
 *
 * Distinct from `AddressRecord` in `addresses.ts`, and the difference is the
 * key: this one hangs off a **customer account**, that one off an
 * **organisation**. Both tables exist because a B2C buyer keeps addresses that
 * are theirs rather than their personal organisation's, and merging the two
 * shapes here would hide which of the two a caller is holding.
 */
export interface CustomerAddressRecord {
  id: string;
  customerAccountId: string;
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Container name: `customerAddressReadPort`. Owner: `customers`.
 *
 * `findById` is scoped by customer account for the reason its organisation
 * twin gives: every caller already knows whose address it is asking for, and
 * one query is what stops the ownership check being forgotten.
 *
 * **`liveOnly` defaults to `false`: `findById` returns a soft-deleted address.**
 * Same split as {@link AddressReadPort} — the by-id lookup resolves an id
 * something else already stored, so it answers with the row it finds;
 * `listForCustomer` is choosing an address to use *now*, so it filters
 * `deletedAt: null` unconditionally and takes no flag.
 *
 * The intended consumer is `quick_order`'s one-click default eligibility check,
 * which today spells the rule itself:
 * `personal != null && !personal.deletedAt && personal.customerAccountId === customerAccountId`
 * (`quick_order/services/default-preference-service.ts`). Two of those three
 * conjuncts do become redundant against this port; **`!personal.deletedAt` does
 * not**. Dropping it with the others makes deleted addresses eligible one-click
 * shipping defaults, so a cut passes `{ liveOnly: true }` (Phase-P
 * unreached-port audit, A8).
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `customers` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface CustomerAddressReadPort {
  findById(
    customerAccountId: string,
    addressId: string,
    options?: { liveOnly?: boolean },
  ): Promise<CustomerAddressRecord | null>;
  listForCustomer(
    customerAccountId: string,
    kind?: 'delivery' | 'billing',
  ): Promise<CustomerAddressRecord[]>;
}
