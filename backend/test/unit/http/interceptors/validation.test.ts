import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { ApiInterceptorRegistry } from '../../../../src/http/interceptors/registry.js';
import { RouteTable } from '../../../../src/http/interceptors/route-table.js';
import { validateRegistrations } from '../../../../src/http/interceptors/validation.js';

const noop = async (): Promise<void> => {};

async function tableFor(register: (app: import('fastify').FastifyInstance) => void): Promise<RouteTable> {
  const table = new RouteTable();
  const app = Fastify({ logger: false });
  app.addHook('onRoute', table.onRouteListener);
  register(app);
  await app.ready();
  await app.close();
  return table;
}

describe('interceptor boot validation (feature 060 / T018)', () => {
  it('fails on an unknown target, naming module, interceptor id, and target', async () => {
    const table = await tableFor((app) => {
      app.post('/api/v1/orders', async () => ({}));
    });
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'compliance',
      id: 'gate',
      target: 'POST /api/v1/orderz',
      phase: 'pre',
      handler: noop,
    });
    expect(() => validateRegistrations(registry, table)).toThrow(
      /compliance.*gate.*POST \/api\/v1\/orderz/s,
    );
  });

  it('fails a post-phase registration targeting a streaming route', async () => {
    const table = await tableFor((app) => {
      app.get('/api/v1/admin/invoices/:id/pdf', { config: { streamingResponse: true } }, async () => ({}));
    });
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'branding',
      id: 'stamp-pdf',
      target: 'GET /api/v1/admin/invoices/:id/pdf',
      phase: 'post',
      handler: async () => undefined,
    });
    expect(() => validateRegistrations(registry, table)).toThrow(/streaming/);
  });

  it('allows a pre-phase registration on the same streaming route', async () => {
    const table = await tableFor((app) => {
      app.get('/api/v1/admin/invoices/:id/pdf', { config: { streamingResponse: true } }, async () => ({}));
    });
    const registry = new ApiInterceptorRegistry();
    registry.register({
      module: 'audit',
      id: 'note-download',
      target: 'GET /api/v1/admin/invoices/:id/pdf',
      phase: 'pre',
      handler: noop,
    });
    expect(() => validateRegistrations(registry, table)).not.toThrow();
  });

  it('passes for valid targets and aggregates multiple problems into one error', async () => {
    const table = await tableFor((app) => {
      app.post('/api/v1/orders', async () => ({}));
    });
    const registry = new ApiInterceptorRegistry();
    registry.register({ module: 'ok', id: 'fine', target: 'POST /api/v1/orders', phase: 'pre', handler: noop });
    registry.register({ module: 'bad', id: 'one', target: 'POST /api/v1/nope', phase: 'pre', handler: noop });
    registry.register({ module: 'bad', id: 'two', target: 'GET /api/v1/also-nope', phase: 'post', handler: async () => undefined });
    let message = '';
    try {
      validateRegistrations(registry, table);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('bad');
    expect(message).toContain('POST /api/v1/nope');
    expect(message).toContain('GET /api/v1/also-nope');
    expect(message).not.toContain("'ok'");
  });
});
