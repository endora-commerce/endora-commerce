// Example overlay module plugin (feature 057).
//
// An overlay module's plugin.ts exports `overlayModule` — a factory taking the
// shared OverlayModuleContext and returning a Fastify ModulePlugin. Composition
// discovers it for the active deployment and mounts it exactly like a core
// module's plugin (US2). This one adds a single admin route guarded by the
// module's own permission.

// Relative import — overlay files run at runtime; see the note in the sibling
// price_lists overlay for why `@core/*` is not used here.
import type { OverlayModuleFactory } from '../../../../overlay/overlay-runtime.js';

export const overlayModule: OverlayModuleFactory = (ctx) => async (app) => {
  app.get(
    '/api/v1/admin/example-overlay/ping',
    { preHandler: ctx.requireAdmin('example_overlay:manage') },
    async () => ({ pong: true, module: 'example_overlay' }),
  );
};
