import type { CustomerAccountReadPort } from '@endora-commerce/contracts';

/**
 * Who owns an entry (`specs/170-forms-module/` FR-045, research § Principle XI review).
 *
 * **Server-stamped, from the session only.** A signed-in customer's entry carries their account and
 * the organisation `customerAccountReadPort` resolves for that account — not the one the session
 * carries, which the auth hook leaves empty when its own account read misses; anybody else's entry
 * carries neither, which is the equivalence `form_entries_attribution_chk` enforces. The public
 * submission body has no field for either, and a typed e-mail address never attributes.
 */

/**
 * The request's actor, as the auth hook decorates it: `kind` and, for a customer, the account id —
 * the only fields read here. Structural, so any actor shape passes through.
 */
export interface SubmissionActor {
  readonly kind: string;
  readonly customerAccountId?: string | undefined;
  readonly [field: string]: unknown;
}

export type EntryOwner =
  | { readonly customerAccountId: null; readonly organizationId: null }
  | { readonly customerAccountId: string; readonly organizationId: string };

const NOBODY: EntryOwner = { customerAccountId: null, organizationId: null };

/** Whether the actor is a signed-in customer — the signed-in-only rule's question. */
export function isSignedInCustomer(actor: SubmissionActor | undefined): boolean {
  return actor?.kind === 'customer' && typeof actor.customerAccountId === 'string' && actor.customerAccountId !== '';
}

/**
 * The owner of an entry the actor submits. Total for a customer, and refusing rather than answering
 * `null` — the newsletter's `#organizationOf`: `customer_accounts.organization_id` is `NOT NULL`
 * (D-178), so an account that resolves always has one, and one that does not resolve is not there.
 * Writing the entry as anonymous instead would hide a customer's record from the representative who
 * serves them.
 */
export async function resolveEntryOwner(
  actor: SubmissionActor | undefined,
  accounts: Pick<CustomerAccountReadPort, 'findById'>,
): Promise<EntryOwner> {
  if (!isSignedInCustomer(actor)) return NOBODY;
  const customerAccountId = actor!.customerAccountId!;
  const account = await accounts.findById(customerAccountId);
  if (!account) {
    throw new Error(
      `forms: customer account ${customerAccountId} does not resolve, so the entry it would own has no organisation to carry.`,
    );
  }
  return { customerAccountId, organizationId: account.organizationId };
}
