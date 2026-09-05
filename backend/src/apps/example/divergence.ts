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
  reasons: {
    'decoration:example_overlay:pricingService':
      'Core resolves a line price from the price lists a customer is entitled to. This ' +
      'deployment prefixes the resolved list id so that a reference reader can see, on a live ' +
      'response, which layer produced the price. The wrap delegates to `price_lists` and ' +
      'adjusts what core returned, so a core fix to `resolveLinePrice` still reaches this ' +
      'deployment — which is the whole difference between decorating and replacing (D-28).',
    'interceptor:example_overlay:GET /api/v1/admin/example-overlay/ping#post':
      'Core serves nothing on this endpoint: the route is this deployment’s own, and the ' +
      'interceptor stamps its response so that the reference deployment demonstrates the ' +
      'rung-2 seam end to end. It runs after the handler and adds a field; it vetoes nothing ' +
      'and writes nothing, which is what a `post` interceptor may do.',
    'registration:example_overlay:exampleOverlayService':
      'Core registers no service of this name — it is this deployment’s own, and it exists so ' +
      'that the container’s ownership ledger has an overlay claimant to answer for. A core ' +
      'module registering `exampleOverlayService` would collide loudly, which is the property ' +
      'being demonstrated.',
  },
};
