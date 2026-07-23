import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { RouteTable } from '../../../../src/http/interceptors/route-table.js';

async function collect(register: (app: import('fastify').FastifyInstance) => void): Promise<RouteTable> {
  const table = new RouteTable();
  const app = Fastify({ logger: false });
  app.addHook('onRoute', table.onRouteListener);
  register(app);
  await app.ready();
  await app.close();
  return table;
}

describe('RouteTable onRoute collector (feature 060 / T003)', () => {
  it('records "<METHOD> <pattern>" identities for registered routes', async () => {
    const table = await collect((app) => {
      app.get('/api/v1/orders/:id', async () => ({}));
      app.post('/api/v1/orders', async () => ({}));
    });
    expect(table.has('GET /api/v1/orders/:id')).toBe(true);
    expect(table.has('POST /api/v1/orders')).toBe(true);
    expect(table.has('GET /api/v1/orders')).toBe(false);
  });

  it('expands multi-method route declarations to one identity per method', async () => {
    const table = await collect((app) => {
      app.route({ method: ['PUT', 'PATCH'], url: '/api/v1/things/:id', handler: async () => ({}) });
    });
    expect(table.has('PUT /api/v1/things/:id')).toBe(true);
    expect(table.has('PATCH /api/v1/things/:id')).toBe(true);
  });

  it('excludes the auto-registered HEAD mirror of a GET route', async () => {
    const table = await collect((app) => {
      app.get('/api/v1/orders', async () => ({}));
    });
    expect(table.has('HEAD /api/v1/orders')).toBe(false);
  });

  it('excludes the OpenAPI document and docs routes', async () => {
    const table = await collect((app) => {
      app.get('/api/v1/_openapi.json', async () => ({}));
      app.get('/api/v1/_docs', async () => ({}));
      app.get('/api/v1/real', async () => ({}));
    });
    expect(table.has('GET /api/v1/_openapi.json')).toBe(false);
    expect(table.has('GET /api/v1/_docs')).toBe(false);
    expect(table.has('GET /api/v1/real')).toBe(true);
  });

  it('captures the streamingResponse config flag', async () => {
    const table = await collect((app) => {
      app.get('/api/v1/admin/invoices/:id/pdf', { config: { streamingResponse: true } }, async () => ({}));
      app.get('/api/v1/plain', async () => ({}));
    });
    expect(table.get('GET /api/v1/admin/invoices/:id/pdf')?.streamingResponse).toBe(true);
    expect(table.get('GET /api/v1/plain')?.streamingResponse).toBe(false);
  });

  it('records routes registered inside encapsulated child contexts', async () => {
    const table = await collect((app) => {
      void app.register(async (scoped) => {
        scoped.get('/api/v1/scoped/route', async () => ({}));
      });
    });
    expect(table.has('GET /api/v1/scoped/route')).toBe(true);
  });
});
