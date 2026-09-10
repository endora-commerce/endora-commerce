// Example deployment — the reference CLIENT-ONLY overlay module.
//
// It exists only for the `example` deployment, is discovered without editing
// the shared core registry (feature 057, FR-004), and is composed by the kernel
// container exactly as a core module is (D-103). Read it as the thing to copy:
// every seam below is here because a deployment will want it, and the two
// things it deliberately does NOT do are as load-bearing as the four it does.
//
// **It ships no `plugin.ts`.** There is one composition path for an overlay
// module and this is it. The second path — a `plugin.ts` exporting a factory
// over a hand-maintained `OverlayModuleContext` — is gone: it could not gate a
// route, could not decorate, could not publish or read a port, and every
// capability a deployment wanted had to be added to that context by a core
// change, which is the coupling the overlay pattern exists to avoid.
//
// **It ships no `entities/` and no `migrations/`.** A per-deployment overlay
// contributes registrations, routes, decorations, interceptors, permissions,
// i18n and a manifest, and no schema (D-106, narrowing D-105). The reason is not
// migration ordering — that argument was measured false and is retired. It is
// that an overlay lives in the same repository and the same build as core, so
// the remedy is always available and costs nothing but a directory: ship the
// table from a core module and read it through that module's port. The
// generator refuses both directories rather than emitting metadata for a table
// nothing creates — see `scripts/generate-composer.ts`.
//
// **It registers nothing twice.** Everything below is registered here, once.

import type { ModuleContext } from '../../../../kernel/index.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * The one method this deployment intercepts on the core pricing engine.
 *
 * Named structurally rather than imported from `price_lists`: an overlay module
 * lives under `src/apps/<deployment>/modules/`, and `check:module-boundary`
 * holds it to the same rule a core module is held to — it may not name a file
 * in another module's directory, `import type` included. So a decoration
 * declares the shape of what it wraps and delegates the rest, which is also the
 * honest description of what a decoration does.
 */
interface PricedLine {
  readonly priceListId: string;
}

interface DecoratedPricing {
  resolveLinePrice(input: never): Promise<PricedLine | null>;
}

/** A service of this module's own, so the ownership ledger has an overlay claimant. */
export class ExampleOverlayService {
  greeting(): string {
    return 'example overlay';
  }
}

export interface ExampleOverlayCradle {
  readonly requireAdmin: RequireAdminFactory;
  readonly exampleOverlayService: ExampleOverlayService;
}

export function registerModule(ctx: ModuleContext): void {
  // 1. A registration of its own. The name is claimed like any other: a core
  //    module registering `exampleOverlayService` would collide loudly.
  ctx.di.register({
    exampleOverlayService: ctx.asClass(ExampleOverlayService).singleton(),
  });

  // 2. The decoration — the one seam that exists only for a deployment.
  //
  //    `pricingService` is a **core** registration owned by a **core** module
  //    (`price_lists`). A core module wrapping it is refused
  //    (`ForeignDecorationError`); a deployment's overlay module is exempt,
  //    and the exemption is derived from the root the module was discovered
  //    under, never from anything the module says about itself.
  //
  //    It delegates (D-28): core runs, and the client adjusts what core
  //    produced, so a core fix to `resolveLinePrice` reaches this deployment.
  //    A Proxy rather than a spread or an `Object.create`, because the inner
  //    value is a class instance: a spread would drop its prototype methods and
  //    a prototype chain would run them against an object holding none of their
  //    state.
  ctx.di.decorate<DecoratedPricing>('pricingService', (inner) =>
    new Proxy(inner, {
      get(target, property, receiver): unknown {
        if (property !== 'resolveLinePrice') {
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return async (input: never): Promise<PricedLine | null> => {
          const line = await target.resolveLinePrice(input);
          return line === null ? null : { ...line, priceListId: `overlay:${line.priceListId}` };
        };
      },
    }),
  );

  // 3. Routes through `ctx.routes`, so the lifecycle gate is applied at the
  //    registration seam. This route used to be a bare `app.get` in a
  //    `plugin.ts` that composition pushed unwrapped: switching the module off
  //    left it answering. Never gate per handler; never register routes outside
  //    this seam.
  ctx.routes(async (app) => {
    app.get(
      '/api/v1/admin/example-overlay/ping',
      { preHandler: ctx.cradle<ExampleOverlayCradle>().requireAdmin('example_overlay:manage') },
      async () => ({
        pong: true,
        module: 'example_overlay',
        greeting: ctx.cradle<ExampleOverlayCradle>().exampleOverlayService.greeting(),
      }),
    );
  });

  // 4. An API interceptor over the module's own endpoint. `module` is stamped
  //    from `module.id` by the context, so the attribution the gating predicate
  //    reads cannot be a hand-written string that drifts from the module it
  //    names.
  ctx.interceptors([
    {
      id: 'stamp-ping',
      target: 'GET /api/v1/admin/example-overlay/ping',
      phase: 'post',
      handler: async ({ payload }: { payload: unknown }) => ({
        ...(payload as object),
        stampedByOverlay: true,
      }),
    },
  ]);
}
