import type { ReducedDeploymentDeclaration } from '@endora-commerce/contracts';

/**
 * `acceptance` ships the full module set, so it declares no omission — D-101.
 *
 * The file exists anyway, empty, for the reason `example`'s does: the mechanism
 * is easier to find than to remember, and an absent file means the same thing
 * while teaching nobody. The declaration is two-way — an entry for a module this
 * deployment does ship fails the boot exactly as loudly as an undeclared
 * omission.
 */
export const reducedDeployment: ReadonlyArray<ReducedDeploymentDeclaration> = [];
