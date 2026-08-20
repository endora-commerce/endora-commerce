import type { ReducedDeploymentDeclaration } from '@b2b/contracts';

/**
 * `example` ships the full module set, so it declares no omission — D-101.
 *
 * The file exists anyway, empty, because the mechanism is easier to find than to
 * remember: a deployment that genuinely drops a module has to say so here, with
 * a reason, or the platform refuses to boot (`assertLockedModulesPresent`). An
 * absent file means the same thing and teaches nobody.
 *
 * The declaration is **two-way**. An entry for a module this deployment does
 * ship fails the boot exactly as loudly as an undeclared omission: a stale entry
 * is how a deployment silently reacquires the hazard it once declared.
 */
export const reducedDeployment: ReadonlyArray<ReducedDeploymentDeclaration> = [];
