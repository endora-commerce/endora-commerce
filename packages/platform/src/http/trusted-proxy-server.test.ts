// Issue #220 — what `request.ip` is when the request arrives through a proxy.
//
// Driven over a real socket rather than `app.inject()`: the whole question is
// how Fastify combines the connection's remote address with the
// `X-Forwarded-For` header, and an injected request has no connection.

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../composition/index.js';
import type { TrustedProxy } from './trusted-proxy.js';

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
        instance.get('/test-client-ip', async (request) => ({
          ip: request.ip,
          ips: request.ips ?? [],
          protocol: request.protocol,
        }));
      },
    ],
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no TCP address');
  return `http://127.0.0.1:${address.port}`;
}

interface Observed {
  ip: string;
  ips: string[];
  protocol: string;
}

async function observe(baseUrl: string, headers: Record<string, string>): Promise<Observed> {
  const response = await fetch(`${baseUrl}/test-client-ip`, { headers });
  return (await response.json()) as Observed;
}

async function observedClientIp(baseUrl: string): Promise<string> {
  return (await observe(baseUrl, { 'x-forwarded-for': FORWARDED_CLIENT_IP })).ip;
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

  // Fastify 5.12.1 (GHSA-3m5p-2c4r-xxw2) removed the numeric `trustProxy` —
  // at runtime a number now fails closed, so `TRUSTED_PROXY_HOPS=1` would
  // silently stop resolving the client. The hop count is translated into the
  // `(address, hop) => boolean` form, and these pin that the translation is
  // exactly the old `(_, i) => i < hops` of fastify <= 5.12.0.
  describe('a hop count keeps the pre-5.12.1 hop semantics', () => {
    it('hops=1 behind one proxy: the client is the forwarded address, not the proxy', async () => {
      const baseUrl = await startServer(1);
      const seen = await observe(baseUrl, { 'x-forwarded-for': FORWARDED_CLIENT_IP });
      expect(seen.ip).toBe(FORWARDED_CLIENT_IP);
      expect(seen.ips).toEqual(['127.0.0.1', FORWARDED_CLIENT_IP]);
    });

    it('hops=0 trusts nothing: the client is the socket peer', async () => {
      const baseUrl = await startServer(0);
      const seen = await observe(baseUrl, { 'x-forwarded-for': FORWARDED_CLIENT_IP });
      expect(seen.ip).toBe('127.0.0.1');
    });

    it('does not believe entries a client prepended beyond the trusted hops', async () => {
      const spoofed = '198.51.100.66';
      const baseUrl = await startServer(1);
      const seen = await observe(baseUrl, {
        'x-forwarded-for': `${spoofed}, ${FORWARDED_CLIENT_IP}`,
      });
      expect(seen.ip).toBe(FORWARDED_CLIENT_IP);
      expect(seen.ips).not.toContain(spoofed);
    });

    it('hops=2 walks exactly two hops back and no further', async () => {
      const spoofed = '198.51.100.66';
      const innerProxy = '10.0.0.2';
      const baseUrl = await startServer(2);
      const seen = await observe(baseUrl, {
        'x-forwarded-for': `${spoofed}, ${FORWARDED_CLIENT_IP}, ${innerProxy}`,
      });
      expect(seen.ip).toBe(FORWARDED_CLIENT_IP);
      expect(seen.ips).toEqual(['127.0.0.1', innerProxy, FORWARDED_CLIENT_IP]);
    });

    it('believes X-Forwarded-Proto from the trusted proxy, as the numeric form did', async () => {
      const baseUrl = await startServer(1);
      const seen = await observe(baseUrl, {
        'x-forwarded-for': FORWARDED_CLIENT_IP,
        'x-forwarded-proto': 'https',
      });
      expect(seen.protocol).toBe('https');
    });
  });

  it('the address list still resolves the client through a spoofed prefix', async () => {
    const spoofed = '198.51.100.66';
    const baseUrl = await startServer(['127.0.0.1']);
    const seen = await observe(baseUrl, {
      'x-forwarded-for': `${spoofed}, ${FORWARDED_CLIENT_IP}`,
    });
    expect(seen.ip).toBe(FORWARDED_CLIENT_IP);
  });
});
