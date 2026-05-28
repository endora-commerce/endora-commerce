import { z } from 'zod';
import {
  addressSnapshotSchema,
  isoDateTimeSchema,
  organizationRoleSchema,
  uuidSchema,
} from './common.js';

/**
 * Organizations, customer accounts, addresses, invitations — Source of truth
 * per Principle V. Drives US2 + US3.
 * See specs/001-b2b-platform-foundation/contracts/organizations.contract.md.
 */

// --- Primitives --------------------------------------------------------------

/**
 * Organization lifecycle status (feature 026 consolidation).
 *
 *  - `pending_verification` — newly registered, blocks transactions until
 *    moderator approves (manual moderation mode) or auto-activated.
 *  - `active` — may transact normally.
 *  - `blocked` — operator-blocked (replaces the legacy `suspended`); the
 *    Organization cannot place Orders or Quote Requests; reversible.
 *  - `rejected` — moderator rejected at registration; terminal.
 */
export const organizationStatusSchema = z.enum([
  'pending_verification',
  'active',
  'blocked',
  'rejected',
]);
export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;

export const vatStatusSchema = z.enum(['vat_payer', 'vat_exempt', 'reverse_charge']);
export type VatStatus = z.infer<typeof vatStatusSchema>;

export const addressKindSchema = z.enum(['delivery', 'billing']);
export type AddressKind = z.infer<typeof addressKindSchema>;

// --- Resources --------------------------------------------------------------

export const organizationSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  taxId: z.string(),
  status: organizationStatusSchema,
  vatStatus: vatStatusSchema,
  registeredAddress: addressSnapshotSchema.omit({ recipientName: true, phone: true }).extend({
    recipientName: z.string().optional(),
    phone: z.string().optional(),
  }),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Organization = z.infer<typeof organizationSchema>;

export const customerAccountSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: organizationRoleSchema,
  emailVerifiedAt: isoDateTimeSchema.nullable(),
  twoFactorEnabled: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CustomerAccount = z.infer<typeof customerAccountSchema>;

export const addressSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  kind: addressKindSchema,
  recipientName: z.string(),
  street: z.string(),
  city: z.string(),
  postalCode: z.string(),
  country: z.string().length(2),
  phone: z.string().nullable().optional(),
  isDefault: z.boolean(),
});
export type Address = z.infer<typeof addressSchema>;

// --- Requests --------------------------------------------------------------

/** Polish NIP or a generic tax-id string; exact validation lives in the backend. */
const taxIdSchema = z.string().min(8).max(32);

export const registerOrganizationRequestSchema = z.object({
  organization: z.object({
    name: z.string().min(1).max(255),
    taxId: taxIdSchema,
    registeredAddress: z.object({
      street: z.string().min(1).max(255),
      city: z.string().min(1).max(120),
      postalCode: z.string().min(1).max(20),
      country: z.string().length(2),
    }),
    vatStatus: vatStatusSchema.optional(),
  }),
  firstUser: z.object({
    email: z.string().email(),
    password: z.string().min(12).max(256),
    firstName: z.string().min(1).max(120),
    lastName: z.string().min(1).max(120),
  }),
  acceptedTermsVersion: z.string(),
});
export type RegisterOrganizationRequest = z.infer<typeof registerOrganizationRequestSchema>;

export const emailVerificationRequestSchema = z.object({
  token: z.string().min(10),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(12).max(256),
});

export const customerLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  twoFactorCode: z.string().optional(),
});

/**
 * Outcome of the anonymous-cart → customer-cart merge that runs inside the
 * customer-login flow (feature 037-cart-merge-on-login).
 *
 * Internal shape — split between two `noop_*` variants so the audit /
 * observability paths can distinguish "anon cart was empty" from "no anon
 * cart was supplied". The HTTP-facing shape collapses both into a single
 * `'noop'`; see `cartMergeOutcomePublicSchema` below.
 */
export const cartMergeOutcomeSchema = z.object({
  outcome: z.enum(['adopted', 'merged', 'noop_empty', 'noop_no_anon']),
  movedLineCount: z.number().int().min(0),
  summedLineCount: z.number().int().min(0),
  destinationCartId: uuidSchema,
});
export type CartMergeOutcome = z.infer<typeof cartMergeOutcomeSchema>;

/**
 * Public (HTTP) narrowing of `cartMergeOutcomeSchema`. The storefront only
 * needs three buckets to decide whether to surface the merge-confirmation
 * toast (`adopted | merged → toast`, `noop → silent`) and the destination
 * cart id for the next cart read.
 */
export const cartMergeOutcomePublicSchema = z.object({
  outcome: z.enum(['adopted', 'merged', 'noop']),
  destinationCartId: uuidSchema,
});
export type CartMergeOutcomePublic = z.infer<typeof cartMergeOutcomePublicSchema>;

/**
 * Customer login response. The `cartMerge` field is populated when the
 * login carries an anonymous-cart cookie; `null` when no anon cookie was
 * supplied; `outcome: 'noop'` when the cookie was supplied but had no
 * observable effect (no anon cart, or the anon cart was empty).
 */
export const customerLoginResponseSchema = z.object({
  data: z.object({
    customerAccount: z.object({
      id: uuidSchema,
      email: z.string().email(),
      organizationId: uuidSchema.nullable(),
      role: organizationRoleSchema,
      twoFactorEnabled: z.boolean(),
    }),
    cartMerge: cartMergeOutcomePublicSchema.nullable().optional(),
  }),
});
export type CustomerLoginResponse = z.infer<typeof customerLoginResponseSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(12).max(256),
});

export const createAddressRequestSchema = z.object({
  kind: addressKindSchema,
  recipientName: z.string().min(1).max(160),
  street: z.string().min(1).max(255),
  city: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(20),
  country: z.string().length(2),
  phone: z.string().max(32).optional(),
  isDefault: z.boolean().optional(),
});
export type CreateAddressRequest = z.infer<typeof createAddressRequestSchema>;

export const updateAddressRequestSchema = createAddressRequestSchema.partial();
export type UpdateAddressRequest = z.infer<typeof updateAddressRequestSchema>;

export const inviteMemberRequestSchema = z.object({
  email: z.string().email(),
  role: organizationRoleSchema.optional(),
});

export const acceptInvitationRequestSchema = z.object({
  password: z.string().min(12),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
});

export const changeMemberRoleRequestSchema = z.object({
  role: organizationRoleSchema,
});

/** Platform admin — PATCH `/admin/organizations/:id` */
export const adminPatchOrganizationRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  vatStatus: vatStatusSchema.optional(),
  status: organizationStatusSchema.optional(),
  expectedUpdatedAt: z.string().optional(),
});

/** Platform admin — POST `/admin/organizations/:id/recover-admin-access` */
export const adminRecoverOrgAccessRequestSchema = z.object({
  promoteCustomerAccountId: uuidSchema,
});

/** Platform admin — POST `/admin/organizations/:id/members` (direct create) */
export const adminDirectMemberRequestSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  password: z.string().min(12).max(256),
  role: organizationRoleSchema.optional(),
});

/** Platform admin — PATCH member role */
export const adminPatchMemberRoleRequestSchema = z.object({
  role: organizationRoleSchema,
  expectedUpdatedAt: z.string().optional(),
});

/** Platform admin — PATCH `/admin/organizations/:id/members/:customerAccountId` (profile) */
export const adminPatchMemberProfileRequestSchema = z
  .object({
    firstName: z.string().min(1).max(120).optional(),
    lastName: z.string().min(1).max(120).optional(),
    email: z.string().email().optional(),
    expectedUpdatedAt: z.string().optional(),
  })
  .refine((b) => b.firstName !== undefined || b.lastName !== undefined || b.email !== undefined, {
    message: 'At least one of firstName, lastName, email is required',
  });

// --- Responses (convenience) ------------------------------------------------

export const registerOrganizationResponseSchema = z.object({
  organization: organizationSchema,
  customerAccount: customerAccountSchema,
  emailVerificationSent: z.boolean(),
});
export type RegisterOrganizationResponse = z.infer<typeof registerOrganizationResponseSchema>;

// --- Sales-rep ↔ organization assignment (feature 008) ---------------------

export const salesRepAssignmentSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  adminUserId: uuidSchema,
  displayName: z.string(),
  email: z.string().email(),
  assignedAt: isoDateTimeSchema,
  assignedByAdminUserId: uuidSchema.nullable(),
});
export type SalesRepAssignment = z.infer<typeof salesRepAssignmentSchema>;

export const assignSalesRepRequestSchema = z.object({
  adminUserId: uuidSchema,
});
export type AssignSalesRepRequest = z.infer<typeof assignSalesRepRequestSchema>;

export const salesRepOrganizationSchema = z.object({
  organizationId: uuidSchema,
  name: z.string(),
  openRfqCount: z.number().int().nonnegative(),
  assignedAt: isoDateTimeSchema,
});
export type SalesRepOrganization = z.infer<typeof salesRepOrganizationSchema>;
