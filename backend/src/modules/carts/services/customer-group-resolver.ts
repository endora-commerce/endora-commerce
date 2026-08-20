import type { CustomerAccountReadPort, OrganizationDetailsPort } from '@b2b/contracts';

/**
 * The effective customer group of a cart's owner (issue #177).
 *
 * The chain is the platform's one answer to "which group is this buyer in":
 * the account's own group, else the Organization's, else none. The pricing
 * engine spells it as `context.customerGroupId ?? organization.customerGroupId`
 * and `pwa`'s push audience builder as `account.customerGroupId ?? orgGroup`;
 * this is the same rule for the promotion engine, which had been receiving a
 * hard-coded `null` on every cart path since the field was introduced.
 *
 * Both rows arrive over their owners' published ports, so a switched-off
 * `customer_accounts` or `organizations` refuses here rather than answering
 * "no group" — which reads as a legitimate answer and is not one: it silently
 * withdraws every group-targeted discount from every buyer.
 *
 * An anonymous cart has neither an account nor an Organization and resolves to
 * `null`, which is the correct answer rather than a degraded one.
 */
export async function resolveCartCustomerGroupId(
  ports: {
    customerAccounts: CustomerAccountReadPort;
    organizations: OrganizationDetailsPort;
  },
  owner: { customerAccountId: string | null; organizationId: string | null },
): Promise<string | null> {
  if (owner.customerAccountId) {
    const account = await ports.customerAccounts.findById(owner.customerAccountId);
    if (account?.customerGroupId) return account.customerGroupId;
  }
  if (owner.organizationId) {
    const organization = await ports.organizations.findById(owner.organizationId);
    if (organization?.customerGroupId) return organization.customerGroupId;
  }
  return null;
}
