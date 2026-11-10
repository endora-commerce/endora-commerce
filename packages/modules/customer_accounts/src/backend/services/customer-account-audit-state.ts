import type { CustomerAccount } from '../entities/customer-account.entity.js';

/**
 * The audit state of the customer-account writes.
 */

/** Every top-level key a customer-account audit state may hold. */
export const CUSTOMER_ACCOUNT_AUDIT_KEYS: ReadonlySet<string> = new Set([
  'changedFields',
  'changedCustomFields',
  'organizationRoleId',
  'emailVerified',
  'blockedAt',
  'blockSource',
  'hasBlockReason',
  'customerAccountId',
  'role',
]);

/** An account that came into being: `customer_account.register_standalone` / `.register_social`. */
export function accountCreatedAuditState(
  account: Pick<CustomerAccount, 'email' | 'firstName' | 'lastName' | 'organizationId' | 'organizationRoleId' | 'emailVerifiedAt'>,
): Record<string, unknown> {
  return { email: account.email };
}
