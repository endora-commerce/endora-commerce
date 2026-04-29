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

export const organizationStatusSchema = z.enum([
  'pending_verification',
  'active',
  'suspended',
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
