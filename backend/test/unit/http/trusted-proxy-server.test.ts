// Issue #220 — what `request.ip` is when the request arrives through a proxy.
//
// Driven over a real socket rather than `app.inject()`: the whole question is
// how Fastify combines the connection's remote address with the
// `X-Forwarded-For` header, and an injected request has no connection.

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '@endora-commerce/platform/composition';
import type { TrustedProxy } from '../../../src/http/trusted-proxy.js';

const FORWARDED_CLIENT_IP = '203.0.113.7';

let app: FastifyInstance | undefined;

async function startServer(trustedProxy?: TrustedProxy): Promise<string> {
  app = await buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: { title: 'trusted proxy test', version: 'test', serverUrl: 'http://localhost' },
    disableRateLimit: true,
    ...(trustedProxy === undefined ? {} : { trustedProxy }),
    modules: [
      (instance): void => {
        instance.get('/test-client-ip', async (request) => ({ ip: request.ip }));
      },
    ],
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  return `http://127.0.0.1:${address.port}`;
}

async function observedClientIp(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/test-client-ip`, {
    headers: { 'x-forwarded-for': FORWARDED_CLIENT_IP },
  });
  const body = (await response.json()) as { ip: string };
  return body.ip;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('buildServer trusted-proxy option', () => {
  it('ignores X-Forwarded-For by default — merging this changes nothing', async () => {
    const baseUrl = await startServer();
    expect(await observedClientIp(baseUrl)).toBe('127.0.0.1');
  });

  it('reports the forwarded client when one hop is trusted', async () => {
    const baseUrl = await startServer(1);
    expect(await observedClientIp(baseUrl)).toBe(FORWARDED_CLIENT_IP);
  });

  it('reports the forwarded client when the proxy address is trusted', async () => {
    const baseUrl = await startServer(['127.0.0.1']);
    expect(await observedClientIp(baseUrl)).toBe(FORWARDED_CLIENT_IP);
  });

  it('ignores a forwarded client arriving from an untrusted address', async () => {
    const baseUrl = await startServer(['10.9.9.9']);
    expect(await observedClientIp(baseUrl)).toBe('127.0.0.1');
  });
});
