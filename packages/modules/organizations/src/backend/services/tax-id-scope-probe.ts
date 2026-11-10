import type { TaxIdScope } from '@endora-commerce/contracts';
import { enforcementOf, type TaxIdScopeStatus } from './tax-id-scope-service.js';

/**
 * `specs/177-tax-id-scope/` (`contracts/tax-id-scope.md` §7, research R-4) — the
 * boot-time comparison of the policy row with the constraint the database has.
 *
 * They can only disagree after a hand edit of the schema or a restore of one
 * without the other. A disagreement is logged at `error`, once per boot, and
 * never fails the boot: the repair — re-applying the scope, which re-asserts
 * its constraint (FR-016) — needs a running admin.
 */
export function describeTaxIdScopeMismatch(state: {
  scope: TaxIdScope;
  constraints: readonly string[];
}): string | null {
  if (enforcementOf(state.scope, state.constraints) === 'consistent') return null;
  const present = state.constraints.length > 0 ? state.constraints.join(', ') : 'no tax-ID constraint';
  return `organizations: tax-ID scope mismatch — policy says ${state.scope}, database has ${present}; re-apply the scope from Organizations → Tax-ID scope`;
}

export async function probeTaxIdScope(
  scopes: { status(): Promise<Pick<TaxIdScopeStatus, 'scope' | 'constraints'>> },
  log: { error(context: object, message: string): void },
): Promise<void> {
  let status: Pick<TaxIdScopeStatus, 'scope' | 'constraints'>;
  try {
    status = await scopes.status();
  } catch (error) {
    log.error(
      { err: error instanceof Error ? error.message : String(error) },
      'organizations: the tax-ID scope could not be compared with the database constraints at boot',
    );
    return;
  }
  const message = describeTaxIdScopeMismatch(status);
  if (message !== null) log.error({ taxIdScope: status.scope, constraints: [...status.constraints] }, message);
}
