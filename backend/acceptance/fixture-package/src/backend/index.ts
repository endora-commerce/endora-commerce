// The fixture module's `./backend` entry point.
//
// Shaped exactly like a core module's `backend.ts` (feature 072): it exports
// `registerModule(ctx)` and the entity classes it owns. Everything it does is
// something a real module does — one registration of its own, one gated route
// through `ctx.routes`, one permission enforced on that route — so that when
// the platform learns to compose packages, nothing here has to change for the
// acceptance criterion to go green.
//
// `ModuleContext` and `RequireAdminFactory` are **imported from the published
// host package**, which is what this file looks like from outside the
// repository: `@endora-commerce/platform` is a non-optional peer dependency,
// the instance supplies exactly one copy, and the specifier is a bare package
// name that resolves through the host's own `exports` map (feature 080, T042a;
// D-160.1/D-160.7).
//
// Both were declared **structurally** here until the host package existed, and
// the half of that comment which is still true is the half worth keeping:
// naming a file inside this repository — a relative path, a `paths` alias, a
// deep reach into `backend/src` — would put a path back into the repository on
// the module's resolution path, which is the trap assertion A8 exists to
// refuse. A published package's bare specifier is not that: it resolves to an
// installed artefact, and the instance owns the copy.

import type { ModuleContext, RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { AcceptanceProbeRow } from './acceptance-probe-row.entity.js';
import { ACCEPTANCE_PROBE_PERMISSION } from '../manifest.js';

/**
 * Every entity this package owns — what a package-aware ORM config merges — and
 * the **only** way any of them leaves the package (D-168).
 *
 * There is deliberately no `export { AcceptanceProbeRow }` beside it. A named
 * class export is what makes `import type { AcceptanceProbeRow } from
 * '@endora-commerce/mod-acceptance-probe/backend'` compile in a consumer's own
 * tree, where none of this repository's checks run; without it that import is
 * TS2305 and Principle I holds by construction. Nothing legitimate needs the
 * class: D-32 forbids an ORM relation into another module's entity and every
 * other cross-module read goes through a contract type.
 */
export const entities = [AcceptanceProbeRow] as const;

/** The slice of `requireAdmin`'s cradle contract this module resolves. */
interface ProbeCradle {
  readonly requireAdmin: RequireAdminFactory;
}

export function registerModule(ctx: ModuleContext): void {
  // Through `ctx.routes`, so the lifecycle gate is applied at the registration
  // seam and the route answers 503 MODULE_DISABLED when an operator switches
  // the module off (assertion A6). Never gated per handler.
  ctx.routes((app) => {
    app.get(
      '/api/v1/admin/acceptance-probe/ping',
      {
        preHandler: ctx.cradle<ProbeCradle>().requireAdmin(ACCEPTANCE_PROBE_PERMISSION),
      },
      async () => ({ pong: true, module: 'acceptance_probe' }),
    );
  });
}
