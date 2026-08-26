import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerRollupScopePort } from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
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
 * the tree traversal as an injected argument (`subtreeIds`) so it never reaches
 * into the organizations module's internals (Principle I). The capability read
 * runs under a system scope because the tenant context is being *established*
 * by the caller — it does not exist yet (mirrors the auth org resolver).
 *
 * **Feature 080 (T040b) — a published port rather than an exported function.**
 * Its only two callers are the composition roots, which used to import this
 * file: a value import of a module's source, which is the spelling that stops
 * existing the day the module becomes a package (D-160.6.1). The rule is
 * unchanged and so is the query, including the single-column projection and the
 * system scope; what changed is that the roots resolve it from the container
 * they already composed.
 */
export class CustomerRollupScopeService implements CustomerRollupScopePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async resolveSubtreeIds(
    customerAccountId: string,
    organizationId: string | null,
    subtreeIds: (organizationId: string) => Promise<string[]>,
  ): Promise<string[] | undefined> {
    if (!organizationId) return undefined;
    const enabled = await withSystemScope('tenant: resolve customer roll-up flag', async () => {
      const account = await this.emFactory().findOne(
        CustomerAccount,
        { id: customerAccountId },
        { fields: ['subtreeRollupEnabled'] },
      );
      return account?.subtreeRollupEnabled ?? false;
    });
    if (!enabled) return undefined;
    return subtreeIds(organizationId);
  }
}
