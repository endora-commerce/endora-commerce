/**
 * The local registry lets go of its upstream.
 *
 * `local-registry.ts` forwards every name it does not hold to an upstream
 * registry and pipes the answer through. A client that stops reading — pnpm
 * abandons a download it no longer needs — used to end the *client's* half
 * only: the upstream request stayed open with its body unread, and `close()`
 * did not end it either. Against npmjs the socket under it kept the process's
 * event loop alive after `close()` had resolved, for as long as the upstream
 * chose — 60 s and 240 s in two measurements, with nothing on this side to
 * bound it.
 *
 * The upstream here is a real `node:http` server whose body never ends, so
 * "released" is observable as the upstream seeing its connection close.
 */

import { createServer, request, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';

import { startLocalRegistry, type LocalRegistry } from '../../../scripts/acceptance/local-registry.js';

interface StallingUpstream {
  readonly url: string;
  /** Resolves when the upstream sees the forwarded request's connection close. */
  readonly released: Promise<void>;
  readonly server: Server;
}

/** An upstream that sends the head and one chunk of a body, and never the rest. */
async function stallingUpstream(): Promise<StallingUpstream> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((done) => {
    release = done;
  });
  const server = createServer((_request, response: ServerResponse) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.write(Buffer.alloc(64 * 1024, 1));
    response.on('close', release);
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  return { url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, released, server };
}

/** Ask the registry for a forwarded tarball; resolve on the first byte of its body. */
function firstByteOf(registry: LocalRegistry, abandon: boolean): Promise<void> {
  return new Promise((gotByte, failed) => {
    const outgoing = request(`${registry.url}/somebody-elses/-/somebody-elses-1.0.0.tgz`, (incoming) => {
      incoming.once('data', () => {
        if (abandon) outgoing.destroy();
        gotByte();
      });
      incoming.on('error', () => undefined);
    });
    outgoing.on('error', (error) => (abandon ? undefined : failed(error)));
    outgoing.end();
  });
}

const within = (promise: Promise<void>, ms: number): Promise<'released' | 'still-open'> =>
  Promise.race([
    promise.then(() => 'released' as const),
    new Promise<'still-open'>((late) => setTimeout(() => late('still-open'), ms)),
  ]);

let upstream: StallingUpstream | null = null;
let registry: LocalRegistry | null = null;

afterEach(async () => {
  await registry?.close();
  registry = null;
  upstream?.server.closeAllConnections();
  await new Promise<void>((closed) => (upstream === null ? closed() : upstream.server.close(() => closed())));
  upstream = null;
});

describe('the local registry and its upstream', () => {
  it('ends the upstream request when the client abandons a forwarded download', async () => {
    upstream = await stallingUpstream();
    registry = await startLocalRegistry({ tarballs: [], upstream: upstream.url });

    await firstByteOf(registry, true);

    expect(await within(upstream.released, 3_000)).toBe('released');
  });

  it('ends every upstream request still in flight when it is closed', async () => {
    upstream = await stallingUpstream();
    registry = await startLocalRegistry({ tarballs: [], upstream: upstream.url });
    await firstByteOf(registry, false);

    await registry.close();

    expect(await within(upstream.released, 3_000)).toBe('released');
  });

  it('closes within a bound while a forwarded download is in flight', async () => {
    upstream = await stallingUpstream();
    registry = await startLocalRegistry({ tarballs: [], upstream: upstream.url });
    await firstByteOf(registry, false);

    expect(await within(registry.close(), 3_000)).toBe('released');
  });
});
