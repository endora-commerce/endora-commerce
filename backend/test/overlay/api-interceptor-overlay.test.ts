import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  ApiInterceptorRegistry,
  RouteTable,
  makePreDispatchOnRoute,
  makePostDispatchPreSerialization,
  validateRegistrations,
} from '../../src/http/interceptors/index.js';
import {
  loadOverlayModulePlugins,
  type OverlayModuleContext,
} from '../../src/overlay/overlay-runtime.js';

const EXAMPLE: NodeJS.ProcessEnv = { DEPLOYMENT: 'example' } as NodeJS.ProcessEnv;

// Feature 060 (FR-012) x feature 057: a client-only overlay module registers an
// API interceptor through its OverlayModuleContext, and the registration
// executes on the route it targets. Mirrors us2-module-active.test.ts: overlay
// tests wire a bare Fastify instance instead of booting the full server, so we
// replicate buildServer's minimal interceptor wiring (src/http/server.ts).
describe('overlay module registers an API interceptor (T026)', () => {
  it('post-interceptor registered by example_overlay stamps its route response', async () => {
    const apiInterceptors = new ApiInterceptorRegistry();
    const stubCtx = {
      emFactory: () => ({}) as never,
      redis: {} as never,
      eventBus: {} as never,
      commandBus: {} as never,
      auditLogService: {} as never,
      requireAdmin: () => async (): Promise<void> => {},
      apiInterceptors,
    } as unknown as OverlayModuleContext;

    const plugins = await loadOverlayModulePlugins(stubCtx, EXAMPLE);
    expect(plugins.length).toBe(1);

    // Registration happens in the plugin factory, i.e. before app.ready().
    expect(apiInterceptors.registrations().length).toBe(1);

    const app = Fastify();
    // Same wiring buildServer installs when options.apiInterceptors is set.
    const routeTable = new RouteTable();
    app.addHook('onRoute', routeTable.onRouteListener);
    app.addHook('onRoute', makePreDispatchOnRoute(apiInterceptors));
    app.addHook('preSerialization', makePostDispatchPreSerialization(apiInterceptors));
    app.addHook('onReady', async () => {
      validateRegistrations(apiInterceptors, routeTable);
      apiInterceptors.seal();
    });

    for (const plugin of plugins) await plugin(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/example-overlay/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      pong: true,
      module: 'example_overlay',
      stampedByOverlay: true,
    });
    await app.close();
  });
});
