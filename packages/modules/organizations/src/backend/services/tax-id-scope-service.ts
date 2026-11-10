import type { EntityManager } from '@mikro-orm/postgresql';
import type { TaxIdScope } from '@endora-commerce/contracts';
import { TAX_ID_ONE_TREE_CONSTRAINT, TAX_ID_UNIQUE_CONSTRAINT } from './tax-id-conflict.js';

/** At most this many shared tax IDs are listed in a refusal or on the screen (FR-015). */
export const SHARED_TAX_ID_EXAMPLE_LIMIT = 20;

/** The policy row, as the scope Command and the admin screen read it. */
export interface TaxIdScopePolicy {
  readonly scope: TaxIdScope;
  readonly updatedAt: Date;
  readonly updatedByAdminUserId: string | null;
}

/** Tax IDs held by more than one organization — what `per-tree-root → global` must not meet. */
export interface SharedTaxIdReport {
  readonly sharedTaxIdCount: number;
  /** Up to {@link SHARED_TAX_ID_EXAMPLE_LIMIT}, ordered by tax ID. */
  readonly examples: ReadonlyArray<{ taxId: string; organizationIds: string[] }>;
}

/** Whether the constraint the database has is the policy row's (`contracts/tax-id-scope.md` §3). */
export type TaxIdScopeEnforcement = 'consistent' | 'mismatch';

export interface TaxIdScopeStatus extends TaxIdScopePolicy {
  readonly sharedTaxIdCount: number;
  readonly enforcement: TaxIdScopeEnforcement;
  /** The scope constraints present, by name — for the boot probe's sentence. */
  readonly constraints: readonly string[];
}

const SCOPE_CONSTRAINTS = [TAX_ID_UNIQUE_CONSTRAINT, TAX_ID_ONE_TREE_CONSTRAINT] as const;

/** The constraint each scope stands on (`contracts/tax-id-scope.md` §1). */
export function constraintOfScope(scope: TaxIdScope): string {
  return scope === 'global' ? TAX_ID_UNIQUE_CONSTRAINT : TAX_ID_ONE_TREE_CONSTRAINT;
}

/** `consistent` iff exactly the scope's own constraint is present. */
export function enforcementOf(scope: TaxIdScope, constraints: readonly string[]): TaxIdScopeEnforcement {
  return constraints.length === 1 && constraints[0] === constraintOfScope(scope) ? 'consistent' : 'mismatch';
}

/**
 * `specs/177-tax-id-scope/` (research R-4, R-5; `contracts/tax-id-scope.md`
 * §1–§3, §7) — the installation's tax-ID scope: the policy row, the constraint
 * enforcing it, and the swap between the two shapes.
 *
 * Every read takes an `em`, so a write path reads the scope inside its own
 * transaction (FR-026) and there is no cache to go stale. The swap is DDL and
 * runs on the caller's transaction: `organization.tax_id_scope.set` is the only
 * production caller, and the test harness's template seed the only other one
 * (research R-16). Each statement is guarded — `add` only when absent, `drop if
 * exists` — so a re-run after a partial manual change converges (FR-016).
 */
export class TaxIdScopeService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /** The policy row; `forUpdate` locks it for the rest of the transaction (R-5 step 1). */
  async readPolicy(em?: EntityManager, options: { forUpdate?: boolean } = {}): Promise<TaxIdScopePolicy> {
    const rows = (await (em ?? this.emFactory()).execute(
      `select "scope", "updated_at", "updated_by_admin_user_id"
         from "organization_tax_id_policy" where "id"${options.forUpdate ? ' for update' : ''}`,
    )) as Array<{ scope: TaxIdScope; updated_at: Date | string; updated_by_admin_user_id: string | null }>;
    const row = rows[0];
    // The migration seeds the row; a database without it predates the scope.
    if (!row) return { scope: 'global', updatedAt: new Date(0), updatedByAdminUserId: null };
    return {
      scope: row.scope,
      updatedAt: new Date(row.updated_at),
      updatedByAdminUserId: row.updated_by_admin_user_id,
    };
  }

  /** The scope in force, read on `em` — inside the caller's transaction when it has one. */
  async scope(em?: EntityManager): Promise<TaxIdScope> {
    return (await this.readPolicy(em)).scope;
  }

  /** Which of the two scope constraints exist, by name, sorted. */
  async presentConstraints(em?: EntityManager): Promise<string[]> {
    const rows = (await (em ?? this.emFactory()).execute(
      `select "conname" from pg_constraint
        where conrelid = 'organizations'::regclass and conname in (?, ?)
        order by "conname"`,
      [...SCOPE_CONSTRAINTS],
    )) as Array<{ conname: string }>;
    return rows.map((row) => row.conname);
  }

  /** Every tax ID held by more than one organization, soft-deleted rows included. */
  async sharedTaxIds(em?: EntityManager): Promise<SharedTaxIdReport> {
    const executor = em ?? this.emFactory();
    const [{ count }] = (await executor.execute(
      `select count(*)::int as "count" from (
         select 1 from "organizations" where "tax_id" is not null group by "tax_id" having count(*) > 1
       ) shared`,
    )) as [{ count: number }];
    if (count === 0) return { sharedTaxIdCount: 0, examples: [] };
    const rows = (await executor.execute(
      `select "tax_id", array_agg("id"::text order by "created_at", "id") as "ids"
         from "organizations" where "tax_id" is not null
        group by "tax_id" having count(*) > 1
        order by "tax_id" limit ?`,
      [SHARED_TAX_ID_EXAMPLE_LIMIT],
    )) as Array<{ tax_id: string; ids: string[] }>;
    return {
      sharedTaxIdCount: count,
      examples: rows.map((row) => ({ taxId: row.tax_id, organizationIds: row.ids })),
    };
  }

  /**
   * Blocks writes to `organizations` — inserts, tax-ID and path updates — for
   * the rest of the transaction, so the duplicate report and the constraint
   * build see one table. Readers are not blocked.
   */
  async lockOrganizations(em: EntityManager): Promise<void> {
    await em.execute(`lock table "organizations" in share row exclusive mode`);
  }

  /**
   * Makes the database enforce `scope`: its constraint added when absent, then
   * the other one dropped — adding first keeps the table covered throughout.
   * Callers moving to `global` check {@link sharedTaxIds} first: the unique
   * constraint cannot be built over a shared tax ID.
   */
  async applyEnforcement(em: EntityManager, scope: TaxIdScope): Promise<void> {
    await this.lockOrganizations(em);
    const add =
      scope === 'global'
        ? `alter table "organizations" add constraint "${TAX_ID_UNIQUE_CONSTRAINT}" unique ("tax_id")`
        : `alter table "organizations" add constraint "${TAX_ID_ONE_TREE_CONSTRAINT}"
             exclude using gist ("tax_id" with =, "root_id" with <>) deferrable initially deferred`;
    const drop = scope === 'global' ? TAX_ID_ONE_TREE_CONSTRAINT : TAX_ID_UNIQUE_CONSTRAINT;
    await em.execute(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
           where conrelid = 'organizations'::regclass and conname = '${constraintOfScope(scope)}'
        ) then
          ${add};
        end if;
        alter table "organizations" drop constraint if exists "${drop}";
      end
      $$;
    `);
  }

  /** Records `scope` on the policy row, with the actor who set it. */
  async writePolicy(em: EntityManager, scope: TaxIdScope, actorAdminUserId: string | null): Promise<void> {
    await em.execute(
      `update "organization_tax_id_policy"
          set "scope" = ?, "updated_at" = now(), "updated_by_admin_user_id" = ?
        where "id"`,
      [scope, actorAdminUserId],
    );
  }

  /** What the admin screen and the boot probe read (`contracts/tax-id-scope.md` §3, §7). */
  async status(em?: EntityManager): Promise<TaxIdScopeStatus> {
    const executor = em ?? this.emFactory();
    const policy = await this.readPolicy(executor);
    const constraints = await this.presentConstraints(executor);
    const { sharedTaxIdCount } = await this.sharedTaxIds(executor);
    return { ...policy, sharedTaxIdCount, constraints, enforcement: enforcementOf(policy.scope, constraints) };
  }
}
