import type { EntityManager } from '@mikro-orm/postgresql';
import type { CreditLimitReadPort } from '@endora-commerce/contracts';
import type { OrganizationTreeService } from './organization-tree-service.js';

/**
 * OrganizationInheritanceService (feature 056 US3) — the organizations-owned
 * resolution port that the price-list resolver and the credit-limit service
 * call to walk the ancestor chain (Principle I). No schema change to
 * `price_lists` / `credit_limits`; inheritance is resolution semantics (R5/R6).
 *
 * Flat behavior is preserved: for a root org (no ancestors) the price-list org
 * chain is `[orgId]` and `creditOwner` is the org itself (or none), collapsing
 * to today's single-org resolution byte-for-byte (FR-013).
 */

export type CreditInheritanceMode = 'shared_pool' | 'independent_default';

export interface CreditOwner {
  /** Nearest ancestor-or-self holding a `CreditLimit` row, or null when none exists. */
  readonly ownerOrgId: string | null;
  /** Effective mode: the owner's per-org column, else the Settings global default. */
  readonly mode: CreditInheritanceMode;
}

export class OrganizationInheritanceService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly treeService: OrganizationTreeService,
    /**
     * `creditLimitReadPort`, owned by `credit_limits` — which links of an
     * ancestor chain hold a limit at all (feature 077, D-87).
     *
     * **Required**, and third rather than last, because the optional shape is
     * the one that fails open: a composition that omitted it would answer
     * "nobody in this chain has a limit" for every organisation, which is a
     * plausible reading and the wrong one. The read it replaces was raw SQL
     * against that module's table, so an absent or switched-off owner made no
     * difference to the answer at all.
     */
    private readonly creditLimits: CreditLimitReadPort,
    /**
     * Resolves the Settings global default `organizations.hierarchy.credit_inheritance_mode`.
     * Defaults to `shared_pool` (factory default, R6) when not injected.
     */
    private readonly resolveGlobalCreditMode: () => Promise<CreditInheritanceMode> = async () =>
      'shared_pool',
  ) {}

  /** Ancestor ids of `orgId`, nearest-first (parent → … → root). `[]` for a root. */
  async ancestorIds(orgId: string): Promise<string[]> {
    return this.treeService.ancestorIds(orgId);
  }

  /**
   * Ordered org candidate set for price-list resolution: `[orgId, ...ancestorIds]`
   * (nearest-first). A nearer org outranks a farther ancestor (R5).
   */
  async priceListOrgChain(orgId: string): Promise<string[]> {
    return [orgId, ...(await this.treeService.ancestorIds(orgId))];
  }

  /**
   * Nearest ancestor-or-self holding a `CreditLimit` row, plus the effective
   * credit-inheritance mode (the owner's per-org column, else the global default).
   * `ownerOrgId` is null when neither the org nor any ancestor has a limit.
   */
  async creditOwner(orgId: string): Promise<CreditOwner> {
    const chain = [orgId, ...(await this.treeService.ancestorIds(orgId))]; // nearest-first

    // Which orgs in the chain hold a credit limit? Asked of the module that
    // owns the table, not selected out of it (feature 077, D-87). No `catch`:
    // a switched-off `credit_limits` must refuse here rather than report an
    // empty chain, which downstream reads as "no limit applies".
    const hasLimit = new Set(await this.creditLimits.organizationsWithLimit(chain));
    const ownerOrgId = chain.find((id) => hasLimit.has(id)) ?? null;

    if (!ownerOrgId) {
      return { ownerOrgId: null, mode: await this.resolveGlobalCreditMode() };
    }

    // This module's own table, so it stays a statement here.
    const modeRows = (await this.emFactory().getConnection().execute(
      `select "credit_inheritance_mode" from "organizations" where "id" = ?`,
      [ownerOrgId],
    )) as Array<{ credit_inheritance_mode: CreditInheritanceMode | null }>;
    const ownMode = modeRows[0]?.credit_inheritance_mode ?? null;
    const mode = ownMode ?? (await this.resolveGlobalCreditMode());
    return { ownerOrgId, mode };
  }
}
