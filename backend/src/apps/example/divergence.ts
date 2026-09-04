import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

/**
 * How `example` means to differ from core — and it means to differ in nothing.
 *
 * The file exists anyway, empty, because the mechanism is easier to find than to
 * remember: a deployment that genuinely drops a module has to say so here, with
 * a reason, or the platform refuses to boot (`assertLockedModulesPresent`). An
 * absent file means the same thing and teaches nobody. Every field is written
 * out for that same reason — a field an author never sees is a field they never
 * learn they have.
 *
 * Three things are declared here and only three, because they are the three no
 * walk can produce:
 *
 *  - `omittedModules` — a module this deployment does not ship, with a reason
 *    in prose. D-101, and the boot refuses an omission that is not here. The
 *    declaration is **two-way**: an entry for a module this deployment does ship
 *    fails the boot exactly as loudly as an undeclared omission, because a stale
 *    entry is how a deployment silently reacquires the hazard it once declared.
 *  - `decorationOrder` — the wrapping order for a registration more than one of
 *    this deployment's overlay modules decorates. Checked, never applied.
 *  - `reasons` — one sentence per divergence the platform derives, keyed by the
 *    derived entry's own key. It answers; it cannot enumerate.
 *
 * Anything the platform can derive is derived and does not belong here: the
 * module list, the routes, the locales, and whether a module is switched on —
 * that last one is the operator's axis, on `/platform/modules`.
 */
export const divergence: DeploymentDivergenceDeclaration = {
  omittedModules: [],
  decorationOrder: {},
  reasons: {},
};
