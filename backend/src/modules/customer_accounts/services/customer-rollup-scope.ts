import type { EntityManager } from '@mikro-orm/postgresql';
import { withSystemScope } from '../../../tenancy/escape-hatch.js';
import { CustomerAccount } from '../entities/customer-account.entity.js';

/**
 * Feature 056 (T032) — customer roll-up scope derivation.
 *
 * Resolves, server-side, whether a customer login widens from single-org to its
 * organization's subtree (Principle XI — derived from the authenticated actor,
 * never request inputs). Returns the subtree id set when the customer holds the
 * `subtreeRollupEnabled` capability, else `undefined` (stay single-org).
 *
 * Lives in the `customer_accounts` module (owner of `CustomerAccount`) and takes
 * the tree traversal as an injected port (`subtreeIds`) so it never reaches into
 * the organizations module's internals (Principle I). The capability read runs
 * under a system scope because the tenant context is being *established* here —
 * it does not exist yet (mirrors the auth org resolver).
 */
export async function resolveCustomerRollupSubtreeIds(
  emFactory: () => EntityManager,
  subtreeIds: (organizationId: string) => Promise<string[]>,
  customerAccountId: string,
  organizationId: string | null,
): Promise<string[] | undefined> {
  if (!organizationId) return undefined;
  const enabled = await withSystemScope('tenant: resolve customer roll-up flag', async () => {
    const account = await emFactory().findOne(
      CustomerAccount,
      { id: customerAccountId },
      { fields: ['subtreeRollupEnabled'] },
    );
    return account?.subtreeRollupEnabled ?? false;
  });
  if (!enabled) return undefined;
  return subtreeIds(organizationId);
}
