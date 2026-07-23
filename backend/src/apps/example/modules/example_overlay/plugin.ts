// Example overlay module plugin (feature 057).
//
// An overlay module's plugin.ts exports `overlayModule` — a factory taking the
// shared OverlayModuleContext and returning a Fastify ModulePlugin. Composition
// discovers it for the active deployment and mounts it exactly like a core
// module's plugin (US2). This one adds a single admin route guarded by the
// module's own permission, plus a demonstration API interceptor registration
// (feature 060, FR-012) stamping the route's response in the post phase.

// Relative import — overlay files run at runtime; see the note in the sibling
// price_lists overlay for why `@core/*` is not used here.
import type { OverlayModuleFactory } from '../../../../overlay/overlay-runtime.js';

export const overlayModule: OverlayModuleFactory = (ctx) => {
  // Interceptors are registered during composition (before app.ready() seals
  // the registry), not inside the Fastify plugin body.
  ctx.apiInterceptors.register({
    module: 'example_overlay',
    id: 'stamp-ping',
    target: 'GET /api/v1/admin/example-overlay/ping',
    phase: 'post',
    handler: async ({ payload }) => ({ ...(payload as object), stampedByOverlay: true }),
  });

  return async (app) => {
    app.get(
      '/api/v1/admin/example-overlay/ping',
      { preHandler: ctx.requireAdmin('example_overlay:manage') },
      async () => ({ pong: true, module: 'example_overlay' }),
    );
  };
};
