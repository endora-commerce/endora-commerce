/**
 * `carts`' admin surface — two routes, one zone contribution and no sidebar
 * entry, declared by the module that owns them (feature 091, Phase 4, batch
 * four, and P7b;
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
import {
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';

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
  zones: [
    // Weight 400 of four contributors to the organization detail's zone
    // (feature 091, P7b): `sales_channels` at 100, `price_lists` at 200,
    // `quick_order` at 300, then this panel. The first three are the order the
    // operator saw when those panels were scattered through
    // `OrganizationDetail.tsx`; this one is last because it is the addition —
    // the panel behind it was imported by nothing and rendered nowhere (§10.5).
    //
    // **`customers:manage`, and not `carts:read`.** Both halves of the policy
    // route enforce it — `packages/modules/carts/src/backend/routes.admin.ts`
    // gates the `GET` and the `PATCH` on that one code — and a contribution
    // declares one. `carts:read` opens this module's cart list and says nothing
    // about an organization's policy, so declaring it would render a toggle
    // that 403s on its first use.
    zoneComponent('organization.detail.after', () => import('./zones/CartApprovalPolicy.js'), {
      weight: 400,
      requiredPermission: 'customers:manage',
    }),
  ],
};
