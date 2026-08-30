/**
 * `carts`' admin surface — two routes and no sidebar entry, declared by the
 * module that owns them (feature 091, Phase 4, batch four;
 * `specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md`).
 *
 * **The locked-and-nav-less shape.** Batch two rejected this module twice over
 * — once for declaring `activation.nonDeactivatable`, once for contributing no
 * sidebar entry — and `plan.md`'s two rulings retire both grounds. What a
 * locked module still has is the **permission** axis, which
 * `useSurfaceVisibility` gates identically to presence, and what a nav-less
 * module has is the **route**, which `admin/src/App.tsx`'s `ModuleRoute` gates
 * on exactly that predicate. So the off-state proof here is three of the four
 * cases driven over the two routes rather than over a sidebar this module has
 * never had — `admin/test/modules/carts.module-owned-surface.test.tsx` — and
 * the fourth is absent because the platform refuses to have it, which is
 * asserted from the manifest rather than skipped
 * (`backend/test/integration/carts/off-state.test.ts`).
 *
 * **Both routes gate on `carts:read`, which is read from the API and not from
 * the neighbourhood.** `GET /api/v1/admin/carts` and
 * `GET /api/v1/admin/carts/:id` both enforce it
 * (`packages/modules/carts/src/backend/routes.admin.ts`). The detail screen's
 * emergency reject posts to `/api/v1/admin/carts/:id/reject`, which enforces
 * `carts:reject` — that gate stays on the API and is deliberately *not* the
 * route's requirement: `carts:read` is what opens the screen, and an operator
 * holding it but not `carts:reject` is meant to see the cart and be refused the
 * action, which is what the screen already renders.
 *
 * **This entry exports data and nothing else** (R2), like every `./admin`
 * layer: `check:module-boundary`'s D-171 rule designates a subpath as contract
 * surface when it emits no runtime binding, and `./admin` deliberately does not
 * qualify, so a consumer reaching into another module's `./admin` stays a
 * counted boundary reach.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

/** The module's landing route: the platform-wide cart list. */
const ROUTE_PATH = '/carts';

export const contributions: AdminContributions = {
  routes: [
    {
      path: ROUTE_PATH,
      component: () => import('./pages/CartsList.js'),
      requiredPermission: 'carts:read',
      index: true,
    },
    {
      path: `${ROUTE_PATH}/:id`,
      component: () => import('./pages/CartDetail.js'),
      requiredPermission: 'carts:read',
    },
  ],
};
