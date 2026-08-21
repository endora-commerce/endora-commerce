// The fixture module's `./backend` entry point.
//
// Shaped exactly like a core module's `backend.ts` (feature 072): it exports
// `registerModule(ctx)` and the entity classes it owns. Everything it does is
// something a real module does — one registration of its own, one gated route
// through `ctx.routes`, one permission enforced on that route — so that when
// the platform learns to compose packages, nothing here has to change for the
// acceptance criterion to go green.
//
// `ModuleContext` is declared **structurally** below rather than imported.
// There is no published kernel package yet (F4/F11), and naming a file inside
// this repository would put a path back into the repository on the module's
// resolution path — which is the trap assertion A8 exists to refuse. The
// structural shape is the narrow slice this module uses; a mismatch with the
// real `ModuleContext` shows up as a composition failure, not as a silent pass.

import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { AcceptanceProbeRow } from './acceptance-probe-row.entity.js';
import { ACCEPTANCE_PROBE_PERMISSION } from '../manifest.js';

export { AcceptanceProbeRow };

/** Every entity this package owns — what a package-aware ORM config merges. */
export const entities = [AcceptanceProbeRow] as const;

/** The slice of `requireAdmin`'s cradle contract this module resolves. */
interface ProbeCradle {
  readonly requireAdmin: (code: string) => preHandlerHookHandler;
}

/** The slice of the kernel's `ModuleContext` this module uses. */
interface ProbeModuleContext {
  routes(register: (app: FastifyInstance) => Promise<void> | void): void;
  cradle<T>(): T;
}

export function registerModule(ctx: ProbeModuleContext): void {
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
