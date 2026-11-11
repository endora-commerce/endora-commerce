import { ERROR_CODES, type TaxIdScope } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SharedTaxIdReport, TaxIdScopeService } from '../services/tax-id-scope-service.js';

/**
 * `organization.tax_id_scope.set` (`specs/177-tax-id-scope/`, FR-014 … FR-016;
 * `contracts/tax-id-scope.md` §2, research R-5).
 *
 * One transaction, the bus's: the policy row is locked first, so two changes
 * serialise and the second sees the first's result; the scope's constraint and
 * the row then change together, so neither can be seen without the other.
 *
 * - **Same scope** — the enforcement is re-asserted (a constraint dropped by
 *   hand comes back) and nothing is audited: no business state changed.
 * - **To `per-tree-root`** — always allowed.
 * - **To `global`** — refused while any tax ID is on more than one
 *   organization, with the count and up to 20 of them; the unique constraint
 *   could not be built otherwise.
 *
 * The audit state is the scope code alone (`audit-state.md`: the policy is
 * installation-wide and carries no personal data).
 */
export interface SetTaxIdScopeCommandDeps {
  scopes: Pick<TaxIdScopeService, 'readPolicy' | 'lockOrganizations' | 'sharedTaxIds' | 'applyEnforcement' | 'writePolicy'>;
}

export interface SetTaxIdScopeResult {
  readonly scope: TaxIdScope;
  readonly changed: boolean;
}

export function scopeDuplicatesRefusal(report: SharedTaxIdReport): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.ORGANIZATION_TAX_ID_SCOPE_DUPLICATES,
    `The tax-ID scope cannot be set to global while ${report.sharedTaxIdCount} tax ID(s) are held by more than one organization.`,
    {
      code: 'shared_tax_ids',
      sharedTaxIdCount: report.sharedTaxIdCount,
      examples: report.examples.map((example) => ({
        taxId: example.taxId,
        organizationIds: [...example.organizationIds],
      })),
    },
  );
}

export function makeSetTaxIdScopeCommand(
  deps: SetTaxIdScopeCommandDeps,
  input: { scope: TaxIdScope },
): Command<SetTaxIdScopeResult> {
  return {
    action: 'organization.tax_id_scope.set',
    objectType: 'organization_tax_id_policy',
    objectId: 'installation',
    run: async ({ em, actor }) => {
      const current = await deps.scopes.readPolicy(em, { forUpdate: true });
      if (current.scope === input.scope) {
        await deps.scopes.applyEnforcement(em, input.scope);
        return { result: { scope: input.scope, changed: false }, skipAudit: true };
      }
      if (input.scope === 'global') {
        await deps.scopes.lockOrganizations(em);
        const report = await deps.scopes.sharedTaxIds(em);
        if (report.sharedTaxIdCount > 0) throw scopeDuplicatesRefusal(report);
      }
      await deps.scopes.applyEnforcement(em, input.scope);
      await deps.scopes.writePolicy(em, input.scope, actor.actorAdminUserId);
      return {
        result: { scope: input.scope, changed: true },
        before: { scope: current.scope },
        after: { scope: input.scope },
      };
    },
  };
}
