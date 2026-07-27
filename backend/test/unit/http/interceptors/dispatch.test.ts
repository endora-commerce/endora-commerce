import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiInterceptorRegistry } from '../../../../src/http/interceptors/registry.js';
import {
  makePostDispatchPreSerialization,
  makePreDispatchOnRoute,
} from '../../../../src/http/interceptors/dispatch.js';
import { HttpError } from '../../../../src/http/error-envelope.js';
import { ERROR_CODES } from '@b2b/contracts';

interface LogRecord {
  level: 'info' | 'error' | 'debug';
  bindings: Record<string, unknown>;
  args: unknown[];
}

function fakeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  const records: LogRecord[] = [];
  const makeLog = (bindings: Record<string, unknown>) => ({
    child: (childBindings: Record<string, unknown>) => makeLog({ ...bindings, ...childBindings }),
    info: (...args: unknown[]) => records.push({ level: 'info', bindings, args }),
    error: (...args: unknown[]) => records.push({ level: 'error', bindings, args }),
    debug: (...args: unknown[]) => records.push({ level: 'debug', bindings, args }),
  });
  const request = {
    method: 'POST',
    url: '/api/v1/orders',
    routeOptions: { url: '/api/v1/orders', method: 'POST' },
    headers: {},
    body: { amount: 1 },
    query: {},
    params: {},
    log: makeLog({}),
    ...overrides,
  } as unknown as FastifyRequest;
  return { request, records };
}

function runPreDispatch(registry: ApiInterceptorRegistry, request: FastifyRequest): Promise<void> {
  // Extract the appended dispatch preHandler the onRoute listener produces.
  const onRoute = makePreDispatchOnRoute(registry);
  const route = { method: 'POST', url: '/api/v1/orders', handler: async () => ({}) } as Parameters<
    typeof onRoute
  >[0];
  onRoute(route);
  const chain = route.preHandler as Array<
    (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  >;
  const dispatch = chain[chain.length - 1]!;
  return dispatch(request, {} as FastifyReply);
}

describe('interceptor dispatch (feature 060 / T013-T017 semantics)', () => {
  it('pre: applies returned body replacement and logs application at debug with attribution', async () => {
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'loyalty',
      id: 'stamp',
      target: 'POST /api/v1/orders',
      phase: 'pre',
      handler: async ({ body }) => ({ body: { ...(body as object), stamped: true } }),
    });
    registry.seal();
    const { request, records } = fakeRequest();
    await runPreDispatch(registry, request);
    expect((request.body as { stamped?: boolean }).stamped).toBe(true);
    const debugRecord = records.find((r) => r.level === 'debug');
    expect(debugRecord?.bindings).toMatchObject({
      interceptorModule: 'loyalty',
      interceptorId: 'stamp',
      phase: 'pre',
    });
  });

  it('pre: a veto (HttpError) is logged info and rethrown unchanged', async () => {
    const registry = new ApiInterceptorRegistry();
    const veto = new HttpError(403, ERROR_CODES.FORBIDDEN, 'no');
    registry.register({
      module: 'compliance',
      id: 'gate',
      target: 'POST /api/v1/orders',
      phase: 'pre',
      handler: async () => {
        throw veto;
      },
    });
    registry.seal();
    const { request, records } = fakeRequest();
    await expect(runPreDispatch(registry, request)).rejects.toBe(veto);
    const infoRecord = records.find((r) => r.level === 'info');
    expect(infoRecord?.bindings).toMatchObject({ interceptorModule: 'compliance', interceptorId: 'gate' });
    expect(records.some((r) => r.level === 'error')).toBe(false);
  });

  it('pre: an unexpected failure is logged error with attribution and rethrown (fail-closed)', async () => {
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'flaky',
      id: 'boom',
      target: 'POST /api/v1/orders',
      phase: 'pre',
      handler: async () => {
        throw new Error('boom');
      },
    });
    registry.seal();
    const { request, records } = fakeRequest();
    await expect(runPreDispatch(registry, request)).rejects.toThrow('boom');
    const errorRecord = records.find((r) => r.level === 'error');
    expect(errorRecord?.bindings).toMatchObject({
      interceptorModule: 'flaky',
      interceptorId: 'boom',
      phase: 'pre',
      interceptorTarget: 'POST /api/v1/orders',
    });
  });

  it('skips interceptors whose module is disabled per the injected predicate', async () => {
    let enabled = false;
    const registry = new ApiInterceptorRegistry({ isModuleEnabled: () => enabled });
    let ran = 0;
    registry.register({
      module: 'toggled',
      id: 'maybe',
      target: 'POST /api/v1/orders',
      phase: 'pre',
      handler: async () => {
        ran += 1;
      },
    });
    registry.seal();
    const { request } = fakeRequest();
    await runPreDispatch(registry, request);
    expect(ran).toBe(0);
    enabled = true;
    await runPreDispatch(registry, request);
    expect(ran).toBe(1);
  });

  it('post: chains payload replacements in order and skips error responses', async () => {
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'a',
      id: 'one',
      target: 'POST /api/v1/orders',
      phase: 'post',
      order: 1,
      handler: async ({ payload }) => ({ ...(payload as object), chain: ['one'] }),
    });
    registry.register({
      module: 'b',
      id: 'two',
      target: 'POST /api/v1/orders',
      phase: 'post',
      order: 2,
      handler: async ({ payload }) => ({
        ...(payload as object),
        chain: [...((payload as { chain?: string[] }).chain ?? []), 'two'],
      }),
    });
    registry.seal();
    const dispatch = makePostDispatchPreSerialization(registry);
    const { request } = fakeRequest();
    const ok = await dispatch(request, { statusCode: 200 } as FastifyReply, { base: true });
    expect(ok).toEqual({ base: true, chain: ['one', 'two'] });
    const err = await dispatch(request, { statusCode: 404 } as FastifyReply, { error: {} });
    expect(err).toEqual({ error: {} });
  });

  it('post: a failure is logged error with attribution and rethrown', async () => {
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'flaky',
      id: 'post-boom',
      target: 'POST /api/v1/orders',
      phase: 'post',
      handler: async () => {
        throw new Error('post boom');
      },
    });
    registry.seal();
    const dispatch = makePostDispatchPreSerialization(registry);
    const { request, records } = fakeRequest();
    await expect(dispatch(request, { statusCode: 200 } as FastifyReply, {})).rejects.toThrow('post boom');
    const errorRecord = records.find((r) => r.level === 'error');
    expect(errorRecord?.bindings).toMatchObject({
      interceptorModule: 'flaky',
      interceptorId: 'post-boom',
      phase: 'post',
    });
  });
});
