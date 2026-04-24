import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setupTestServer } from '../../helpers/test-server.js';

describe('OpenAPI document', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await setupTestServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('serves a 3.1 document at /api/v1/_openapi.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/_openapi.json' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { openapi: string; info: { title: string } };
    expect(body.openapi).toMatch(/^3\.1/);
    expect(body.info.title).toContain('B2B Platform');
  });

  it('serves an HTML docs viewer at /api/v1/_docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/_docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('swagger-ui');
  });
});
