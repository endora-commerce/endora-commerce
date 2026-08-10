import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from '@fastify/type-provider-zod';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { defineModuleRoutes } from '../../../src/modules/_lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * The off-state harness is about to be used by ~66 modules, so it gets its own
 * test — including the case that matters most: it must **fail** against a
 * module that ignores the gate. A harness that cannot go red is worse than no
 * harness, because every conversion after it would report a green vacuously.
 *
 * Deliberately a unit test over a bare Fastify app: no `setupBackendServer`,
 * no database, no Redis. That is the same budget discipline the harness itself
 * exists to enforce.
 */

const GATED = 'fixture_gated';
const UNGATED = 'fixture_ungated';

describe('expectModuleAbsent', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorEnvelope(app);
    const gated = defineModuleRoutes(GATED, async (scoped) => {
      scoped.get('/api/v1/admin/fixture-gated/ping', async () => ({ ok: true }));
    });
    await gated(app);
    // The failure mode the ratchet exists to catch: a module that registers
    // its routes outside the wrapper.
    app.get('/api/v1/admin/fixture-ungated/ping', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(() => {
    registryCache.__setEnabledForTesting([]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes for a module gated at the route-registration seam', async () => {
    registryCache.__setEnabledForTesting([GATED, UNGATED]);
    await expectModuleAbsent({ app }, GATED, {
      routes: ['/api/v1/admin/fixture-gated/ping'],
    });
  });

  it('fails for a module whose routes bypass the wrapper', async () => {
    registryCache.__setEnabledForTesting([GATED, UNGATED]);
    await expect(
      expectModuleAbsent({ app }, UNGATED, {
        routes: ['/api/v1/admin/fixture-ungated/ping'],
      }),
    ).rejects.toThrow(/should refuse while "fixture_ungated" is off/);
  });

  it('restores the registry state even when an assertion fails', async () => {
    registryCache.__setEnabledForTesting([GATED, UNGATED]);
    await expect(
      expectModuleAbsent({ app }, UNGATED, {
        routes: ['/api/v1/admin/fixture-ungated/ping'],
      }),
    ).rejects.toThrow();
    expect(registryCache.enabledIds()).toEqual([GATED, UNGATED]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/fixture-gated/ping' });
    expect(res.statusCode).toBe(200);
  });

  it('refuses an empty surface declaration rather than passing vacuously', async () => {
    registryCache.__setEnabledForTesting([GATED]);
    await expect(expectModuleAbsent({ app }, GATED, { routes: [] })).rejects.toThrow(
      /passes vacuously/,
    );
  });

  it('refuses to run against a module that was never on', async () => {
    registryCache.__setEnabledForTesting([]);
    await expect(
      expectModuleAbsent({ app }, GATED, { routes: ['/api/v1/admin/fixture-gated/ping'] }),
    ).rejects.toThrow(/not enabled before the test runs/);
  });

  it('exercises the deactivated-while-platform-available axis, not just the platform one', async () => {
    // A seam that resolved the platform axis alone would pass the second half
    // of the harness and fail here — which is exactly what T017 changed.
    registryCache.__setEnabledForTesting([GATED], { deactivated: [GATED] });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/fixture-gated/ping' });
    expect(res.statusCode).toBe(503);
    expect(registryCache.isEnabled(GATED)).toBe(true);
  });
});
