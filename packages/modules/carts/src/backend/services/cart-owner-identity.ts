import type { CustomerAccountRecord } from '@endora-commerce/contracts';

/**
 * How the Organization's cart surfaces name a cart's owner (issue #751): as
 * the members page names a member — first and last name — with the e-mail
 * beside it. An owner with no name falls back to the e-mail, and an account
 * that can no longer be read to the id the cart still carries.
 */
export function cartOwnerIdentity(
  owner: Pick<CustomerAccountRecord, 'email' | 'firstName' | 'lastName'> | null | undefined,
  ownerId: string,
): { ownerDisplayName: string; ownerEmail: string | null } {
  if (!owner) return { ownerDisplayName: ownerId, ownerEmail: null };
  const name = [owner.firstName, owner.lastName]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  return { ownerDisplayName: name || owner.email || ownerId, ownerEmail: owner.email || null };
}
