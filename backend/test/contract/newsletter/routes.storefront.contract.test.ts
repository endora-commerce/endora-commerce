import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newsletterStatusResponseSchema, newsletterSubscribeResponseSchema } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * HTTP-level contract for the public newsletter routes (feature 048, US1),
 * exercised through the real Fastify server + module wiring.
 */
describe('Newsletter storefront routes (feature 048)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reports module status with the per-channel opt-in mode', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/newsletter/status?channel=default' });
    expect(res.statusCode).toBe(200);
    const body = newsletterStatusResponseSchema.parse(res.json().data);
    expect(body.enabled).toBe(true);
    expect(['single', 'double']).toContain(body.optInMode);
  });

  it('subscribes a valid email and returns a status', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      payload: { email: 'contract@example.com', channelCode: 'default' },
    });
    expect(res.statusCode).toBe(200);
    const body = newsletterSubscribeResponseSchema.parse(res.json().data);
    expect(['pending', 'active']).toContain(body.status);
  });

  it('rejects an unknown sales channel with 400', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      payload: { email: 'x@example.com', channelCode: 'no-such-channel' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns a GIF for the open-tracking pixel even with a bad token', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/newsletter/o/bad-token.gif' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
  });
});
