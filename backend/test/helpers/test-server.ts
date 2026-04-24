import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/http/server.js';

/**
 * Boots an in-process Fastify instance for contract tests.
 * Rate limiting is disabled so tests are not flaky; session cookie secret is stable.
 *
 * Usage:
 *   const server = await setupTestServer();
 *   const res = await server.inject({ method: 'GET', url: '/api/v1/_health' });
 *   expect(res.statusCode).toBe(200);
 *   ...
 *   afterAll(() => server.close());
 */

export async function setupTestServer(): Promise<FastifyInstance> {
  return buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: {
      title: 'B2B Platform API (test)',
      version: 'test',
      serverUrl: 'http://localhost',
    },
    disableRateLimit: true,
  });
}
