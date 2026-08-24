// The `acceptance` deployment's one overlay module: a decoration, and nothing
// else (feature 080, T053(c)).
//
// `example_overlay` is the reference for what a deployment may do — a
// registration of its own, a decoration, gated routes, an interceptor. This one
// is deliberately the opposite of a reference: it does the single thing the
// acceptance criterion has to measure, so that a red says one thing.

import type { ModuleContext } from '../../../../kernel/index.js';

/**
 * The shape this deployment wraps, declared **structurally**.
 *
 * There is no other option and that is the point of the assertion. The owner is
 * an installed package in a throwaway instance: the type is not in this
 * repository, the specifier would not resolve in an ordinary build, and even if
 * it did, `check:module-boundary` holds an overlay module to the rule every core
 * module is held to. A decoration therefore declares what it wraps and delegates
 * the rest — which is also the honest description of what a decoration is.
 */
interface DecoratedGreeter {
  greeting(): string;
}

export function registerModule(ctx: ModuleContext): void {
  // `acceptanceProbeGreeter` is registered by `@endora-commerce/mod-acceptance-probe`,
  // an **installed package** — not by a core module and not by a composition
  // root. A core module wrapping someone else's registration is refused
  // (`ForeignDecorationError`); a deployment's overlay module is exempt, and the
  // exemption is set from the root this module was discovered under, never from
  // anything it says about itself (issue #203).
  //
  // It delegates (D-28): the package's own implementation runs and this
  // deployment adjusts what it produced, so a fix inside the package keeps
  // reaching this instance.
  ctx.di.decorate<DecoratedGreeter>('acceptanceProbeGreeter', (inner) => ({
    greeting: () => `overlay:${inner.greeting()}`,
  }));
}
