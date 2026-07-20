import type { EntityManager } from '@mikro-orm/postgresql';
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
    const em = this.emFactory();

    // Which orgs in the chain hold a credit limit? Raw SQL bypasses the @OrgScoped
    // filter — the owner may be an ancestor outside the caller's tenant scope.
    const placeholders = chain.map(() => '?').join(', ');
    const clRows = (await em.getConnection().execute(
      `select "organization_id" from "credit_limits" where "organization_id" in (${placeholders})`,
      chain,
    )) as Array<{ organization_id: string }>;
    const hasLimit = new Set(clRows.map((r) => r.organization_id));
    const ownerOrgId = chain.find((id) => hasLimit.has(id)) ?? null;

    if (!ownerOrgId) {
      return { ownerOrgId: null, mode: await this.resolveGlobalCreditMode() };
    }

    const modeRows = (await em.getConnection().execute(
      `select "credit_inheritance_mode" from "organizations" where "id" = ?`,
      [ownerOrgId],
    )) as Array<{ credit_inheritance_mode: CreditInheritanceMode | null }>;
    const ownMode = modeRows[0]?.credit_inheritance_mode ?? null;
    const mode = ownMode ?? (await this.resolveGlobalCreditMode());
    return { ownerOrgId, mode };
  }
}
