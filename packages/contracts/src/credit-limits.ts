import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Credit Limit module contracts (US6) — see
 * specs/001-b2b-platform-foundation/contracts/credit_limits.contract.md.
 */

export const creditLimitReservationStatusSchema = z.enum(['active', 'released']);
export type CreditLimitReservationStatus = z.infer<typeof creditLimitReservationStatusSchema>;

export const creditLimitReservationReleaseReasonSchema = z.enum([
  'invoice_paid',
  'order_cancelled',
  'admin_revocation',
]);
export type CreditLimitReservationReleaseReason = z.infer<
  typeof creditLimitReservationReleaseReasonSchema
>;

export const creditLimitViewSchema = z.object({
  organizationId: uuidSchema,
  grantedAmount: z.number().finite().nonnegative(),
  availableAmount: z.number().finite(),
  currency: z.string().length(3),
  activeReservations: z.array(
    z.object({
      orderId: uuidSchema,
      amount: z.number().finite(),
      createdAt: isoDateTimeSchema,
    }),
  ),
  grantedAt: isoDateTimeSchema,
});
export type CreditLimitView = z.infer<typeof creditLimitViewSchema>;

export const grantCreditLimitRequestSchema = z.object({
  grantedAmount: z.number().finite().positive(),
  currency: z.string().length(3),
  reason: z.string().max(2000).optional(),
});
export type GrantCreditLimitRequest = z.infer<typeof grantCreditLimitRequestSchema>;

export const adjustCreditLimitRequestSchema = z.object({
  grantedAmount: z.number().finite().nonnegative(),
  reason: z.string().max(2000).optional(),
  allowOverAllocation: z.boolean().optional(),
});
export type AdjustCreditLimitRequest = z.infer<typeof adjustCreditLimitRequestSchema>;

/**
 * Container name: `creditLimitReadPort`. Owner: `credit_limits`.
 *
 * One question, asked by one consumer: `organizations` walks an ancestor chain
 * to decide whose credit limit applies to a descendant, and the only fact it
 * needs from this module is which links in that chain hold a row at all.
 *
 * It used to read the table itself — `select "organization_id" from
 * "credit_limits" where "organization_id" in (…)`, a statement naming no import
 * specifier, so the boundary it crossed compiled and was gated by nothing
 * (feature 077, D-87). The signature is ids in, ids out, which is what puts it
 * here rather than on the package's `./ports` subpath: nothing about it needs a
 * MikroORM `EntityManager`, and D-171's test for that subpath is whether the
 * signature stops the interface living in this package.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`. That is the
 * right answer and not a degradation to soften: an empty set here reads as
 * "nobody in this chain has a limit", which is a plausible answer, and on a
 * credit-check path the wrong one — it is the difference between refusing and
 * quoting unlimited credit. Whether `credit_limits` has an off state at all is
 * its manifest's `activation` to say, not this line's.
 */
export interface CreditLimitReadPort {
  /**
   * Which of `organizationIds` hold a credit-limit row, in no particular
   * order. The caller supplies the chain and decides which hit is nearest.
   *
   * The read crosses organisation scope deliberately: the holder is by
   * definition an ancestor outside the caller's tenant filter, so an
   * implementation that let `@OrgScoped` narrow it would answer the empty set
   * and inheritance would stop working with nothing to show for it.
   *
   * Plain ids, never the module's rows — a `CreditLimit` handed across this
   * seam would be a managed entity the consumer could mutate and flush outside
   * the transaction that loaded it.
   */
  organizationsWithLimit(organizationIds: readonly string[]): Promise<string[]>;
}

/**
 * Container name: `creditLimitService`. Owner: `credit_limits`.
 *
 * The narrow grant/adjust seam over `credit_limits`' own registration, for a
 * module that imports contractor credit limits from an external system: grant
 * on first sight, adjust thereafter. `orders` resolves the same registration
 * under its own `CreditLimitPort` (D-94.5).
 *
 * It was filed in the Comarch XL vendor contract module, which was its first
 * consumer, until that module left `@endora-commerce/contracts` (feature 134,
 * E5). The name is `credit_limits`' to publish, not a vendor's, so it stays
 * here with the owner's other contract types.
 */
export interface ContractorCreditLimitPort {
  getForOrganization(organizationId: string): Promise<{ grantedAmount: string } | null>;
  grant(input: {
    organizationId: string;
    grantedAmount: number;
    currency: string;
  }): Promise<unknown>;
  adjust(input: {
    organizationId: string;
    grantedAmount: number;
    allowOverAllocation?: boolean;
  }): Promise<{ ok: boolean }>;
}
