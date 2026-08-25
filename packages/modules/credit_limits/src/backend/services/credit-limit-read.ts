import type { EntityManager } from '@mikro-orm/postgresql';
import type { CreditLimitReadPort } from '@endora-commerce/contracts';
import { CreditLimit } from '../entities/credit-limit.entity.js';

/**
 * `creditLimitReadPort` — the membership read `organizations` needs to resolve
 * an inherited limit (feature 077, D-87).
 *
 * `OrganizationInheritanceService.creditOwner` walks an ancestor chain and has
 * to know which of those organisations hold a row here. It selected from this
 * module's table to find out — a statement naming no import specifier, so the
 * boundary compiled and returned rows whatever state this module was in.
 *
 * A class rather than a closure in `backend/index.ts` for the reason
 * `OrganizationDetailsService` is one: several suites construct the consumer by
 * hand and have to supply what the container supplies, and the point of a cut
 * is that the **owner's own** implementation answers the question — a stub that
 * agrees with the test's expectations cannot show it.
 */
export class CreditLimitReadService implements CreditLimitReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async organizationsWithLimit(organizationIds: readonly string[]): Promise<string[]> {
    if (organizationIds.length === 0) return [];
    const rows = await this.emFactory().find(
      CreditLimit,
      { organizationId: { $in: [...organizationIds] } },
      // Load-bearing rather than defensive: the holder is by definition an
      // ancestor outside the caller's tenant scope, which is the whole point of
      // the inheritance, so `@OrgScoped` would answer the empty set for every
      // descendant and the feature would silently stop working.
      { filters: { org: false } },
    );
    // Ids, not rows. The consumer gets a value it cannot mutate and flush.
    return rows.map((row) => row.organizationId);
  }
}
