import { z } from 'zod';
import {
  AdminOrganizationCreateBodySchema,
  registerOrganizationRequestSchema,
  vatStatusSchema,
} from '@endora-commerce/contracts';

/**
 * Zod schemas used by feature 026 — moderation, restrictions, and VAT
 * validation. These live in the module (not in `@endora-commerce/contracts`) because
 * they describe internal route bodies; the public contract for the
 * Organization status enum is exported from `@endora-commerce/contracts` and
 * re-imported here.
 */

export const organizationStatusSchema = z.enum([
  'pending_verification',
  'active',
  'blocked',
  'rejected',
]);
export type OrganizationStatusInput = z.infer<typeof organizationStatusSchema>;

// ── Moderation ────────────────────────────────────────────────────────────

export const approveOrganizationSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});
export type ApproveOrganizationInput = z.infer<typeof approveOrganizationSchema>;

export const rejectOrganizationSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().min(1).max(2000),
  notifyCustomerEmail: z.boolean().default(true),
});
export type RejectOrganizationInput = z.infer<typeof rejectOrganizationSchema>;

export const blockOrganizationSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().max(2000).nullable().optional(),
});
export type BlockOrganizationInput = z.infer<typeof blockOrganizationSchema>;

export const unblockOrganizationSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});
export type UnblockOrganizationInput = z.infer<typeof unblockOrganizationSchema>;

// ── Restrictions (per-Organization allow-lists) ───────────────────────────

const uuidList = z.array(z.string().uuid()).max(500);

export const replaceOrgRestrictionsSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  paymentMethodIds: uuidList,
  deliveryMethodIds: uuidList,
  warehouseIds: uuidList,
});
export type ReplaceOrgRestrictionsInput = z.infer<typeof replaceOrgRestrictionsSchema>;

export const patchOrgRestrictionsSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  add: uuidList.optional(),
  remove: uuidList.optional(),
});
export type PatchOrgRestrictionsInput = z.infer<typeof patchOrgRestrictionsSchema>;

// ── VAT validation ────────────────────────────────────────────────────────

export const triggerVatValidationSchema = z.object({
  providerHint: z.enum(['auto', 'vies', 'mf_pl']).default('auto'),
  applyAutoFill: z.boolean().default(false),
});
export type TriggerVatValidationInput = z.infer<typeof triggerVatValidationSchema>;

// ── organizationWritePort (issue #1029) ──────────────────────────────────
//
// The port is an in-process call, but what a connector hands it comes from
// another system: these hold it to the admin API's own limits, so a record the
// admin form would refuse is refused here too, as `VALIDATION_FAILED`.

const registeredAddressSchema = registerOrganizationRequestSchema.shape.organization.shape.registeredAddress;
const legalNameSchema = z.string().min(1).max(255).nullable();

export const organizationWriteCreateInputSchema = AdminOrganizationCreateBodySchema.extend({
  legalName: legalNameSchema.optional(),
  status: z.enum(['active', 'pending_verification']),
});

// Strict: a key the port does not write — the tax ID above all, whose
// correction is `organization.tax_id.change` — is refused, not dropped.
export const organizationWriteUpdatePatchSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    legalName: legalNameSchema.optional(),
    vatStatus: vatStatusSchema.optional(),
    registeredAddress: registeredAddressSchema.optional(),
    orderConfirmationEmails: z.array(z.string().email()).optional(),
  })
  .strict();

export const organizationWriteUpdateOptionsSchema = z.object({
  expectedVersion: z.number().int().nonnegative().optional(),
});
