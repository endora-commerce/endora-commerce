import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { makeGuardsBeforeValidationOnRoute } from './guards-before-validation.js';
import { HttpError, registerErrorEnvelope } from './error-envelope.js';
import { ApiInterceptorRegistry, makePreDispatchOnRoute } from './interceptors/index.js';
import { buildServer } from './server.js';

/**
 * The property under test is an ordering one, so it is asked of a real Fastify
 * instance rather than of the listener's output: what a caller the route
 * refuses is answered when the request would also fail the route's schema.
 */

const bodySchema = z.object({ name: z.string().min(3) });

type Who = FastifyRequest & { who?: string };

/** Stands in for `requireAdmin`: 401 without a session, 403 without the right one. */
const sessionGuard = async (request: FastifyRequest): Promise<void> => {
  const who = (request as Who).who;
  if (who === undefined) throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Session required.');
  if (who !== 'allowed') throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Missing permission.');
};

/**
 * The shape most composed modules hand their routes: a closure that resolves
 * the real guard per request. Nothing about the function says it is a guard.
 */
const forwarded = (): ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
  async (request) => sessionGuard(request);

async function build(options: { listener: boolean }): Promise<FastifyInstance> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  if (options.listener) app.addHook('onRoute', makeGuardsBeforeValidationOnRoute());
  registerErrorEnvelope(app);
  // Stands in for the session resolver. Registered AFTER the listener on
  // purpose: an instance-level hook still runs before any route-level one.
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-who'];
    if (typeof header === 'string') (request as Who).who = header;
  });
  return app;
}

describe("a route's guards run before its schema", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('without the listener the validator answers a caller the guard would refuse (the defect)', async () => {
    app = await build({ listener: false });
    app.post('/guarded', { preHandler: sessionGuard, schema: { body: bodySchema } }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'POST', url: '/guarded', payload: { name: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('answers 401 to a caller with no session, whatever the request holds', async () => {
    app = await build({ listener: true });
    app.post('/guarded', { preHandler: sessionGuard, schema: { body: bodySchema } }, async () => ({ ok: true }));
    for (const payload of [{ name: 1 }, {}, { name: 'abc' }]) {
      const res = await app.inject({ method: 'POST', url: '/guarded', payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(401);
      expect(res.json().error.code).toBe(ERROR_CODES.UNAUTHORIZED);
      expect(res.json().error).not.toHaveProperty('details');
    }
  });

  it('answers 403 to a session without the permission, whatever the request holds', async () => {
    app = await build({ listener: true });
    app.post('/guarded', { preHandler: sessionGuard, schema: { body: bodySchema } }, async () => ({ ok: true }));
    const res = await app.inject({
      method: 'POST',
      url: '/guarded',
      headers: { 'x-who': 'somebody-else' },
      payload: { name: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('covers a guard reached through a forwarding closure, and a guard list', async () => {
    app = await build({ listener: true });
    app.post('/forwarded', { preHandler: forwarded(), schema: { body: bodySchema } }, async () => ({ ok: true }));
    app.post(
      '/listed',
      { preHandler: [forwarded(), async () => undefined], schema: { body: bodySchema } },
      async () => ({ ok: true }),
    );
    for (const url of ['/forwarded', '/listed']) {
      const res = await app.inject({ method: 'POST', url, payload: { name: 1 } });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('leaves the answer to an accepted caller exactly as it was: the same 400, then the handler', async () => {
    const without = await build({ listener: false });
    without.post('/guarded', { preHandler: sessionGuard, schema: { body: bodySchema } }, async () => ({ ok: true }));
    const before = await without.inject({
      method: 'POST',
      url: '/guarded',
      headers: { 'x-who': 'allowed' },
      payload: { name: 1 },
    });
    await without.close();

    app = await build({ listener: true });
    app.post('/guarded', { preHandler: sessionGuard, schema: { body: bodySchema } }, async (request) => ({
      name: (request.body as { name: string }).name,
    }));
    const invalid = await app.inject({
      method: 'POST',
      url: '/guarded',
      headers: { 'x-who': 'allowed' },
      payload: { name: 1 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(invalid.json()).toEqual(before.json());

    const valid = await app.inject({
      method: 'POST',
      url: '/guarded',
      headers: { 'x-who': 'allowed' },
      payload: { name: 'abc' },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ name: 'abc' });
  });

  it('keeps the guards in their written order, after a preValidation hook the route declared itself', async () => {
    app = await build({ listener: true });
    const order: string[] = [];
    const step = (name: string) => async (): Promise<void> => {
      order.push(name);
    };
    app.post(
      '/chain',
      {
        preValidation: step('own preValidation'),
        preHandler: [step('first'), step('second')],
        schema: { body: bodySchema },
      },
      async () => ({ ok: true }),
    );
    const invalid = await app.inject({ method: 'POST', url: '/chain', payload: { name: 1 } });
    expect(invalid.statusCode).toBe(400);
    expect(order).toEqual(['own preValidation', 'first', 'second']);
  });

  it('hands a guard the parsed body, not yet validated', async () => {
    app = await build({ listener: true });
    let seen: unknown = 'never ran';
    app.post(
      '/reads-body',
      {
        preHandler: async (request) => {
          seen = request.body;
        },
        schema: { body: bodySchema },
      },
      async () => ({ ok: true }),
    );
    await app.inject({ method: 'POST', url: '/reads-body', payload: { name: 1, extra: true } });
    expect(seen).toEqual({ name: 1, extra: true });
  });

  it('serves one options object shared by several routes, and leaves it as written', async () => {
    app = await build({ listener: true });
    const shared = { preHandler: sessionGuard, schema: { body: bodySchema } };
    app.post('/a', shared, async () => ({ ok: true }));
    app.post('/b', shared, async () => ({ ok: true }));
    for (const url of ['/a', '/b']) {
      const res = await app.inject({ method: 'POST', url, payload: { name: 1 } });
      expect(res.statusCode, url).toBe(401);
    }
    expect(shared.preHandler).toBe(sessionGuard);
    expect(shared).not.toHaveProperty('preValidation');
  });

  it('answers HEAD the way it answers GET', async () => {
    app = await build({ listener: true });
    app.get(
      '/read',
      { preHandler: sessionGuard, schema: { querystring: z.object({ page: z.coerce.number().int().min(1) }) } },
      async () => ({ ok: true }),
    );
    for (const method of ['GET', 'HEAD'] as const) {
      const res = await app.inject({ method, url: '/read?page=0' });
      expect(res.statusCode, method).toBe(401);
    }
  });

  it('does not move a preHandler added to the instance with addHook', async () => {
    app = await build({ listener: true });
    let sawValidated = false;
    await app.register(async (scoped) => {
      scoped.addHook('preHandler', async () => {
        sawValidated = true;
      });
      scoped.post('/scoped', { schema: { body: bodySchema } }, async () => ({ ok: true }));
    });
    const invalid = await app.inject({ method: 'POST', url: '/scoped', payload: { name: 1 } });
    expect(invalid.statusCode).toBe(400);
    expect(sawValidated).toBe(false);
  });
});

describe('buildServer installs the listener for every route a module mounts', () => {
  it('refuses a caller the guard refuses before validating the request', async () => {
    const app = await buildServer({
      sessionCookieSecret: 'x'.repeat(32),
      openApi: { title: 'test', version: '0.0.0', serverUrl: 'http://localhost' },
      disableRateLimit: true,
      apiInterceptors: new ApiInterceptorRegistry(),
      modules: [
        async (instance) => {
          instance.post(
            '/api/v1/admin/things',
            { preHandler: forwarded(), schema: { body: bodySchema } },
            async () => ({ ok: true }),
          );
        },
      ],
    });
    try {
      const res = await app.inject({ method: 'POST', url: '/api/v1/admin/things', payload: { name: 1 } });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    } finally {
      await app.close();
    }
  });

  it('leaves the API interceptor dispatch where it was: after validation, in preHandler', () => {
    const guards = makeGuardsBeforeValidationOnRoute();
    const interceptors = makePreDispatchOnRoute(new ApiInterceptorRegistry());
    const route = {
      method: 'POST',
      url: '/api/v1/admin/things',
      preHandler: sessionGuard,
      handler: async () => ({}),
    } as Parameters<typeof guards>[0];
    // The order `buildServer` installs them in.
    guards(route);
    interceptors(route);
    expect(route.preValidation).toEqual([sessionGuard]);
    expect(route.preHandler).toHaveLength(1);
    expect((route.preHandler as unknown[])[0]).not.toBe(sessionGuard);
  });
});
