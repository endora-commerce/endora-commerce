import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T224 — `GET /api/v1/_openapi.json` returns a populated OpenAPI 3.1
 * document referencing the routes from every wired module.
 *
 * The Phase 2 OpenAPI integration test (test/integration/http/openapi.test.ts)
 * covers shape + meta. This contract test asserts coverage: every module's
 * canonical entry point is represented.
 */

interface OpenApi {
  openapi: string;
  paths: Record<string, unknown>;
}

const REQUIRED_PATHS = [
  '/api/v1/catalog/products',
  '/api/v1/catalog/products/{idOrSlug}',
  '/api/v1/quote-requests',
  '/api/v1/orders',
  '/api/v1/cart',
  '/api/v1/me/credit-limit',
  '/api/v1/admin/api-keys',
  '/api/v1/admin/webhooks',
];

describe('GET /api/v1/_openapi.json — module coverage', () => {
  let h: BackendServerHandle;
  let doc: OpenApi;

  beforeAll(async () => {
    h = await setupBackendServer();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/_openapi.json' });
    expect(res.statusCode).toBe(200);
    doc = res.json() as OpenApi;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reports OpenAPI 3.1', () => {
    expect(doc.openapi).toMatch(/^3\.1/);
  });

  it('includes the canonical route for every wired module', () => {
    const present = Object.keys(doc.paths);
    for (const required of REQUIRED_PATHS) {
      const matched = present.some(
        (p) => p === required || p.startsWith(required.replace(/\{[^}]+\}/g, '')),
      );
      expect(matched, `expected ${required} (or a prefix) in OpenAPI paths`).toBe(true);
    }
  });
});
