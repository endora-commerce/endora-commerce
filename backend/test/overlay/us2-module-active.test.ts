import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  discoverOverlayModuleManifests,
  loadOverlayModulePlugins,
  type OverlayModuleContext,
} from '../../src/overlay/overlay-runtime.js';
import { REGISTERED_MANIFESTS } from '../../src/modules/_lifecycle/registered-manifests.js';
import { ApiInterceptorRegistry } from '../../src/http/interceptors/index.js';

const EXAMPLE: NodeJS.ProcessEnv = { DEPLOYMENT: 'example' } as NodeJS.ProcessEnv;

// A context whose requireAdmin always passes (auth is exercised elsewhere).
const stubCtx = {
  emFactory: () => ({}) as never,
  redis: {} as never,
  eventBus: {} as never,
  commandBus: {} as never,
  auditLogService: {} as never,
  requireAdmin: () => async (): Promise<void> => {},
  apiInterceptors: new ApiInterceptorRegistry(),
} as unknown as OverlayModuleContext;

// US2 scenario 1 + 3 (SC-001, FR-004/FR-009): a client-only overlay module is
// discovered, active, and permissioned WITHOUT editing the shared core registry.
describe('US2 — overlay-only module is active (T027)', () => {
  it('discovers the example_overlay module for DEPLOYMENT=example', async () => {
    const manifests = await discoverOverlayModuleManifests(EXAMPLE);
    const example = manifests.find((m) => m.id === 'example_overlay');
    expect(example).toBeDefined();
    expect(example?.manifest.permissions?.map((p) => p.code)).toContain('example_overlay:manage');
  });

  it('mounts the overlay module plugin and its route responds', async () => {
    const plugins = await loadOverlayModulePlugins(stubCtx, EXAMPLE);
    expect(plugins.length).toBe(1);

    const app = Fastify();
    for (const plugin of plugins) await plugin(app);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/example-overlay/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pong: true, module: 'example_overlay' });
    await app.close();
  });

  it('does NOT appear in the hand-maintained core registry (FR-004)', () => {
    expect(REGISTERED_MANIFESTS.some((e) => e.manifest.id === 'example_overlay')).toBe(false);
  });
});
