/**
 * `mfa`' admin surface — one route and no sidebar entry, declared by the module
 * that owns it (feature 091, Phase 4, batch four;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The nav-less shape, and it is the reason this module is in the batch.**
 * Batch two rejected `mfa` on the ground that it contributes no sidebar entry,
 * so *"half the ratchet would not move and half the evidence would be
 * missing"*. `plan.md`'s Ruling 1 measured that as sound pilot-evidence
 * reasoning and wrong as a selection rule: `admin/src/App.tsx`'s `ModuleRoute`
 * gates **every** registry-contributed route on `useSurfaceVisibility` — both
 * axes, rendering `NotFoundPage` — so a nav-less module's off-state proof is
 * driven over the **route**, which is what an operator following a stale deep
 * link actually meets. `admin/test/modules/mfa.module-owned-surface.test.tsx`
 * is that proof, and the ratchet's `{ routes: 1, nav: 0 }` entry is removed
 * like any other: a zero that stays zero is a passing assertion, not a missing
 * one.
 *
 * **The route carries no `requiredPermission`, and that is read from the route
 * rather than guessed.** `/security` is the signed-in admin's own two-factor
 * self-service (`packages/modules/mfa/src/backend/routes.self-service.ts`), and
 * every one of its six endpoints is gated by the bare admin guard —
 * `{ preHandler: requireGuard }`, no `requireAdmin(...)` anywhere. An operator
 * manages their own second factor; there is no permission code that could gate
 * it without locking somebody out of their own account. So the declaration
 * omits the field, `isSurfaceVisible` treats an absent requirement as
 * satisfied, and the module's presence is the whole of the gate.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's only admin route: the signed-in admin's own 2FA settings. */
const ROUTE_PATH = '/security';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/AdminSecuritySettings.js'),
      index: true,
    },
  ],
};
