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
  // root. A deployment's overlay module is exempt from the ownership rule on
  // `ctx.di.decorate` (issue #203), and the exemption is set from the root this
  // module was discovered under, never from anything it says about itself.
  //
  // **This call is expected to be refused, and that is what A10 asserts**
  // (D-176 Q3, ruled 2026-08-25). The exemption stops at an installed package:
  // a package's `exports` map publishes `registerModule`, its entities, its
  // migrations and `./ports`, and the container names it registers internally
  // are published by none of them — so there is no declared surface for this
  // wrap to be written against, and `tsc` would hold it to a `dist/*.d.ts` that
  // moves under `pnpm update`. The platform answers
  // `PackageDecorationNotOfferedError`, naming this module, the package and the
  // registration.
  //
  // So the wrap stays, deliberately: it is the reach that makes the refusal
  // measurable. It is also written the way a permitted decoration is written —
  // delegating (D-28), so that if the owner ever opens the capability over a
  // registration a package publishes, what this asserts is the *rule* and not
  // this module's shape.
  ctx.di.decorate<DecoratedGreeter>('acceptanceProbeGreeter', (inner) => ({
    greeting: () => `overlay:${inner.greeting()}`,
  }));
}
