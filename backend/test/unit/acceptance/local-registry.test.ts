/**
 * The `local-registry` acceptance mode's stand-in registry
 * (`specs/080-f4-real-scope/rulings.md` D-271 clause 4).
 *
 * The mode itself packs every publishable package, runs `npx` and boots an
 * instance, so it is a script and not a test. What is proven here is the part
 * a later reader would otherwise have to take on trust: that the packument is
 * the minimal shape the ruling names, that a tarball is served byte for byte
 * under the integrity the packument states, that every other name is forwarded
 * rather than answered, and that nothing can be written to it.
 */
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  packedManifest,
  packumentFor,
  startLocalRegistry,
  tarballFrom,
  type LocalRegistry,
} from '../../../scripts/acceptance/local-registry.js';

/** A gzipped ustar archive holding the given files — the shape `npm pack` writes. */
function tgz(files: Readonly<Record<string, string>>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text, 'utf8');
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'utf8');
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'utf8');
    header.write('0', 156, 1, 'utf8');
    header.write('ustar\0', 257, 6, 'utf8');
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function packed(name: string, version: string, extra: Record<string, unknown> = {}): Buffer {
  return tgz({
    'package/README.md': 'readme\n',
    'package/package.json': JSON.stringify({ name, version, ...extra }),
  });
}

const running: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()!.close();
});

/** A fake upstream that answers every path with its own name, so forwarding is visible. */
async function fakeUpstream(): Promise<{ url: string; paths: string[] }> {
  const paths: string[] = [];
  const server: Server = createServer((request, response) => {
    paths.push(request.url ?? '');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ upstream: request.url }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  running.push({
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  });
  return { url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, paths };
}

async function registry(tarballs: Parameters<typeof startLocalRegistry>[0]['tarballs'], upstream: string): Promise<LocalRegistry> {
  const started = await startLocalRegistry({ tarballs, upstream });
  running.push(started);
  return started;
}

describe('the packed manifest', () => {
  it('is read out of the tarball, which is where `pnpm pack` rewrote the workspace ranges', () => {
    const bytes = packed('@endora-commerce/cli', '0.14.0', { dependencies: { a: '1.0.0' } });
    expect(packedManifest(bytes)).toEqual({
      name: '@endora-commerce/cli',
      version: '0.14.0',
      dependencies: { a: '1.0.0' },
    });
    expect(() => packedManifest(tgz({ 'package/index.js': '' }))).toThrow(/package\/package\.json/);
  });
});

describe('the packument', () => {
  it('is the minimal shape: name, dist-tags.latest, and each version with its dist', () => {
    const bytes = packed('create-endora-commerce', '0.0.0');
    const packument = packumentFor([tarballFrom('/x/create-endora-commerce-0.0.0.tgz', bytes)], 'http://r');
    expect(Object.keys(packument).sort()).toEqual(['dist-tags', 'name', 'versions']);
    expect(packument['dist-tags']).toEqual({ latest: '0.0.0' });
    const version = (packument['versions'] as Record<string, Record<string, unknown>>)['0.0.0']!;
    expect(version['name']).toBe('create-endora-commerce');
    expect(version['dist']).toEqual({
      tarball: 'http://r/-/tarballs/create-endora-commerce-0.0.0.tgz',
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      shasum: createHash('sha1').update(bytes).digest('hex'),
    });
  });
});

describe('the server', () => {
  it('serves a local packument by scoped name, in either spelling, and the tarball byte for byte', async () => {
    const upstream = await fakeUpstream();
    const bytes = packed('@endora-commerce/platform', '1.2.3');
    const local = await registry([tarballFrom('/x/endora-commerce-platform-1.2.3.tgz', bytes)], upstream.url);
    for (const path of ['/@endora-commerce%2fplatform', '/@endora-commerce/platform']) {
      const reply = await fetch(`${local.url}${path}`);
      expect(reply.status).toBe(200);
      const packument = (await reply.json()) as { versions: Record<string, { dist: { tarball: string } }> };
      const tarball = await fetch(packument.versions['1.2.3']!.dist.tarball);
      expect(Buffer.from(await tarball.arrayBuffer()).equals(bytes)).toBe(true);
    }
    expect(local.served).toEqual(['@endora-commerce/platform']);
    expect(upstream.paths).toEqual([]);
  });

  it('forwards every other name upstream, and counts it', async () => {
    const upstream = await fakeUpstream();
    const local = await registry([], upstream.url);
    const reply = await fetch(`${local.url}/fastify`);
    expect(await reply.json()).toEqual({ upstream: '/fastify' });
    expect(upstream.paths).toEqual(['/fastify']);
    expect(local.forwarded()).toBe(1);
  });

  it('refuses every write', async () => {
    const upstream = await fakeUpstream();
    const local = await registry([], upstream.url);
    const reply = await fetch(`${local.url}/@endora-commerce%2fplatform`, { method: 'PUT', body: '{}' });
    expect(reply.status).toBe(405);
    expect(upstream.paths).toEqual([]);
  });
});
