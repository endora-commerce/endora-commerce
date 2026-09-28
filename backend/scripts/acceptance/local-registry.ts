/**
 * A registry on `node:http`, for proving the front door before anything is
 * published (`specs/080-f4-real-scope/rulings.md` D-271 clause 4).
 *
 * It serves the packed tarballs of this checkout's packages under their own
 * names and forwards every other request to an upstream registry (npmjs by
 * default), so `npx`, npm and pnpm pointed at it by `npm_config_registry` see
 * one registry holding both — which is what npmjs will be after the first
 * publish. It is the stand-in, not a registry implementation: it answers the
 * two reads an install makes (a packument, a tarball) and refuses every write.
 *
 * ## The packument is minimal, deliberately
 *
 * `name`, `dist-tags.latest` and `versions[v]` = the packed manifest plus
 * `dist.tarball`, `dist.integrity` and `dist.shasum`. That this is enough for
 * npm and pnpm was D-271's premise *to re-derive*; the `local-registry`
 * acceptance mode (`instance-local-registry.ts`) is the measurement, and a
 * field either client turns out to require belongs here, next to the others.
 *
 * No dependency: `node:http`, `node:zlib`, `node:crypto` and `fetch`.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';

/** One packed tarball, as this registry serves it. */
export interface PackedTarball {
  readonly name: string;
  readonly version: string;
  /** The manifest **inside** the tarball — `pnpm pack` rewrites `workspace:` ranges. */
  readonly manifest: Readonly<Record<string, unknown>>;
  /** The file name the tarball is served under. */
  readonly file: string;
  readonly bytes: Buffer;
}

/**
 * The `package/package.json` inside a gzipped npm tarball.
 *
 * A ustar reader of the one entry an npm tarball is guaranteed to hold, so no
 * `tar` binary is spawned. The `prefix` field is honoured; a long-name
 * extension is not needed for that path and is skipped like any other entry.
 */
export function packedManifest(tgz: Buffer): Record<string, unknown> {
  const tar = gunzipSync(tgz);
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number): string =>
      header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const prefix = field(345, 155);
    const name = prefix.length > 0 ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const body = offset + 512;
    if (name === 'package/package.json') {
      return JSON.parse(tar.subarray(body, body + size).toString('utf8')) as Record<string, unknown>;
    }
    offset = body + Math.ceil(size / 512) * 512;
  }
  throw new Error('the tarball holds no package/package.json');
}

/** A tarball read off disk, ready to serve. */
export function tarballFrom(file: string, bytes: Buffer): PackedTarball {
  const manifest = packedManifest(bytes);
  const name = manifest['name'];
  const version = manifest['version'];
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new Error(`${file}: the packed manifest declares no name or no version`);
  }
  return { name, version, manifest, file: basename(file), bytes };
}

/** The packument for one package name: every version this registry holds of it. */
export function packumentFor(
  tarballs: readonly PackedTarball[],
  baseUrl: string,
): Record<string, unknown> {
  if (tarballs.length === 0) throw new Error('a packument needs at least one version');
  const name = tarballs[0]!.name;
  const versions: Record<string, unknown> = {};
  for (const tarball of tarballs) {
    versions[tarball.version] = {
      ...tarball.manifest,
      dist: {
        tarball: `${baseUrl}/-/tarballs/${encodeURIComponent(tarball.file)}`,
        integrity: `sha512-${createHash('sha512').update(tarball.bytes).digest('base64')}`,
        shasum: createHash('sha1').update(tarball.bytes).digest('hex'),
      },
    };
  }
  const latest = [...tarballs].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })).at(-1)!;
  return { name, 'dist-tags': { latest: latest.version }, versions };
}

/** A running registry. */
export interface LocalRegistry {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  readonly url: string;
  /** Every local package name a packument was served for, in order, de-duplicated. */
  readonly served: readonly string[];
  /** How many requests were forwarded upstream. */
  readonly forwarded: () => number;
  readonly close: () => Promise<void>;
}

/**
 * Start the registry on a free loopback port.
 *
 * Only `GET` and `HEAD` are answered; anything else is `405`, so nothing a
 * client does against it can publish.
 */
export async function startLocalRegistry(options: {
  readonly tarballs: readonly PackedTarball[];
  readonly upstream: string;
}): Promise<LocalRegistry> {
  const upstream = options.upstream.replace(/\/+$/, '');
  const byName = new Map<string, PackedTarball[]>();
  const byFile = new Map<string, PackedTarball>();
  for (const tarball of options.tarballs) {
    byName.set(tarball.name, [...(byName.get(tarball.name) ?? []), tarball]);
    byFile.set(tarball.file, tarball);
  }
  const served: string[] = [];
  let forwarded = 0;
  let baseUrl = '';

  const answer = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'text/plain' }).end('read-only registry\n');
      return;
    }
    const url = new URL(request.url ?? '/', baseUrl);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (path.startsWith('-/tarballs/')) {
      const tarball = byFile.get(path.slice('-/tarballs/'.length));
      if (tarball === undefined) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('no such tarball\n');
        return;
      }
      response
        .writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': tarball.bytes.length })
        .end(request.method === 'HEAD' ? undefined : tarball.bytes);
      return;
    }
    const local = byName.get(path);
    if (local !== undefined) {
      if (!served.includes(path)) served.push(path);
      const body = JSON.stringify(packumentFor(local, baseUrl));
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    forwarded += 1;
    const accept = request.headers['accept'];
    const reply = await fetch(`${upstream}${url.pathname}${url.search}`, {
      method: request.method,
      headers: accept === undefined ? {} : { accept },
      redirect: 'follow',
    });
    const type = reply.headers.get('content-type');
    response.writeHead(reply.status, type === null ? {} : { 'content-type': type });
    if (reply.body === null || request.method === 'HEAD') {
      response.end();
      return;
    }
    Readable.fromWeb(reply.body as import('node:stream/web').ReadableStream).pipe(response);
  };

  const server = createServer((request, response) => {
    answer(request, response).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end(`upstream: ${error instanceof Error ? error.message : String(error)}\n`);
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${String(port)}`;
  return {
    url: baseUrl,
    served,
    forwarded: () => forwarded,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}
