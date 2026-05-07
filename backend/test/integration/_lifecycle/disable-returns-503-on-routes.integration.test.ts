import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from '@fastify/type-provider-zod';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { defineModuleRoutes } from '../../../src/modules/_lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';

/**
 * Integration test for FR-015 / SC-003 — disabled module returns 503
 * (US3).
 *
 * `defineModuleRoutes(moduleId, register)` MUST install an
 * `onRequest` hook that short-circuits with `503 Service Unavailable`
 * + `Retry-After: 60` when the registry cache reports the module as
 * disabled.
 */

describe('defineModuleRoutes — 503 when module disabled (integration)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorEnvelope(app);
    const blogPlugin = defineModuleRoutes('fixture_routes', async (scoped) => {
      scoped.get('/api/v1/admin/fixture-routes/ping', async () => ({ ok: true }));
    });
    await blogPlugin(app);
    await app.ready();
  });

  beforeEach(() => {
    registryCache.__setEnabledForTesting([]);
  });

  afterEach(() => {
    registryCache.__setEnabledForTesting([]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 with MODULE_DISABLED + Retry-After:60 when module is disabled', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/fixture-routes/ping',
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('60');
    const body = res.json();
    expect(body.error?.code).toBe('MODULE_DISABLED');
    expect(body.error?.message).toMatch(/fixture_routes/);
  });

  it('returns 200 when the module is enabled', async () => {
    registryCache.__setEnabledForTesting(['fixture_routes']);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/fixture-routes/ping',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
