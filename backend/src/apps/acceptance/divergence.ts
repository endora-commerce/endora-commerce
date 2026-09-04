import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

/**
 * How `acceptance` means to differ from core — and it means to differ in nothing.
 *
 * The file exists anyway, empty, for the reason `example`'s does: the mechanism
 * is easier to find than to remember, and an absent file means the same thing
 * while teaching nobody. `apps/example/divergence.ts` carries the full note on
 * what each of the three fields is for.
 *
 * The omissions are **two-way** — an entry for a module this deployment does
 * ship fails the boot exactly as loudly as an undeclared omission.
 */
export const divergence: DeploymentDivergenceDeclaration = {
  omittedModules: [],
  decorationOrder: {},
  reasons: {},
};
