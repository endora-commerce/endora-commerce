/**
 * `mfa`' admin surface — the body of the Profile's *Security* tab, and the old
 * address of the screen kept as a redirect (feature 091, Phase 4, batch four;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **Under Profile since issue #1519** (UX audit SHELL-11, owner decision
 * DEC-02). The admin's own two-step verification is about the signed-in
 * account, not about the platform, so it left the sidebar's *System* section
 * when that section was split into *Access* and *Platform*. The host owns the
 * Profile screen, its tab strip and the tab's label; this module fills the
 * tab through the `profile.security` zone, so with the module off there is no
 * tab at all. `/security` forwards to `/profile/security` for bookmarks, and
 * the manifest's `open-security` palette action opens the tab (Principle XVI).
 *
 * **The sidebar entry arrived with issue #510.** Until then `/security` was
 * reachable from neither the sidebar nor the palette, so an admin could not
 * find where to switch two-factor authentication on — Principle XVI forbids
 * that. The entry and the manifest's `open-security` action carried no
 * `requiredPermission`, for the reason the route carries none (below); the
 * zone contribution carries none for the same reason.
 *
 * **The nav-less shape, and it is the reason this module was in the batch.**
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
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

/** The screen's address before issue #1519, kept as a redirect to the Profile tab. */
const LEGACY_ROUTE_PATH = '/security';

export const contributions: AdminContributions = {
  routes: [
    {
      path: LEGACY_ROUTE_PATH,
      component: () => import('./pages/SecurityRedirect.js'),
      // Not `index`: a redirect is nobody's landing screen. The palette's
      // `open-security` opens the destination, `/profile/security`.
    },
  ],
  zones: [
    // The only contribution to this member. Declared with a weight rather than
    // defaulted so a second contributor (a passkeys panel, say) arrives beside
    // it rather than ahead of it by accident.
    zoneComponent('profile.security', () => import('./pages/AdminSecuritySettings.js'), {
      weight: 100,
    }),
  ],
};
