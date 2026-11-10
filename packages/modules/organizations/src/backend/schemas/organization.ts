import { z } from 'zod';
import { normalizeTaxId } from '@endora-commerce/contracts';

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

/**
 * Tax ID — stripped of whitespace and dashes and upper-cased at the Zod
 * boundary (`normalizeTaxId`), then held to the stored length, 8 to 32
 * characters (`specs/177-tax-id-scope/`): a longer value reached
 * `varchar(32)` and answered 500.
 */
export const taxIdSchema = z
  .string()
  .max(255)
  .transform(normalizeTaxId)
  .pipe(z.string().min(8).max(32));

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
