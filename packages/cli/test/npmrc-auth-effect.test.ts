/**
 * The `.npmrc` this package writes, measured by an install rather than by
 * reading it.
 *
 * ## Why this file spawns pnpm
 *
 * The defect it exists for was invisible to every assertion over the file's
 * text: the endpoint auth line was present, correct, and exactly what GitLab's
 * documentation writes — and the install still failed, because the *tarball* is
 * fetched from an address the endpoint key does not cover. A test that reads the
 * generated string can only assert the fix's shape. What has to be true is that
 * **pnpm sends the header for the tarball request**, and the one program that
 * can answer that is pnpm.
 *
 * So there is a registry here: an ordinary `node:http` server on `127.0.0.1`
 * that answers a packument on the endpoint path and names its `dist.tarball` on
 * `/api/v4/projects/302/packages/npm/…` — GitLab's shape, the owning project's
 * path rather than the endpoint's — and records, per request, whether an
 * `Authorization` header arrived. Nothing leaves the loopback interface, the
 * package it serves is a 200-byte tarball this file builds in memory, and the
 * store is a directory inside the temporary tree.
 *
 * ## Both directions, because one of them is the control
 *
 * The previous file shape is written out by hand and installed too. Without it
 * the run would show that the current file works and say nothing about whether
 * the mechanism is the one claimed: the control is what makes
 * `No authorization header was set for the request.` — the sentence the CI
 * failure carried — attributable to the missing key rather than to anything else
 * in the arrangement.
 *
 * ## What it still does not reach
 *
 * A real GitLab. This measures pnpm's credential matching against GitLab's
 * documented tarball layout, not any one GitLab instance's behaviour, and the
 * end-to-end answer belongs to `acceptance:storefront-scaffold` in registry
 * mode, which is the job that has the token.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { npmrcContent, TOKEN_VARIABLE } from '../src/new-storefront/npmrc.js';

const PACKAGE_NAME = '@endora-commerce/fixture-package';
const PACKAGE_VERSION = '1.0.0';
/** GitLab answers an instance-level packument with a tarball on the owning project's path. */
const TARBALL_PATH = `/api/v4/projects/302/packages/npm/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz`;
const METADATA_PATH = `/api/v4/packages/npm/${PACKAGE_NAME}`;
const ENDPOINT_PATH = '/api/v4/packages/npm/';

/**
 * A one-file npm tarball, built here rather than packed by a tool.
 *
 * `pnpm pack` would need a second pnpm invocation and `tar` would need the
 * binary to be on the image; a ustar header is 512 bytes of a documented format
 * and costs neither.
 */
function tarball(): Buffer {
  const manifest = `${JSON.stringify({ name: PACKAGE_NAME, version: PACKAGE_VERSION, main: 'index.js' })}\n`;
  const body = Buffer.from(manifest, 'utf8');
  const header = Buffer.alloc(512);
  header.write('package/package.json', 0, 'utf8'); // name
  header.write('0000644\0', 100, 'utf8'); // mode
  header.write('0000000\0', 108, 'utf8'); // uid
  header.write('0000000\0', 116, 'utf8'); // gid
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'utf8'); // size
  header.write('00000000000\0', 136, 'utf8'); // mtime
  header.write('        ', 148, 'utf8'); // checksum, spaces while it is computed
  header.write('0', 156, 'utf8'); // typeflag: regular file
  header.write('ustar\0', 257, 'utf8');
  header.write('00', 263, 'utf8');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'utf8');
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  return gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)]));
}

interface Request {
  readonly path: string;
  readonly authorized: boolean;
}

let server: Server;
let port = 0;
let requests: Request[] = [];

beforeAll(async () => {
  const tgz = tarball();
  const integrity = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
  const shasum = createHash('sha1').update(tgz).digest('hex');

  server = createServer((request, response) => {
    const path = decodeURIComponent(request.url ?? '');
    const authorized = typeof request.headers.authorization === 'string';
    requests.push({ path, authorized });

    // Both halves answer an absent credential the way GitLab does — 404, and
    // never 401 (`specs/104-package-publication/research.md` §6). A 401 here
    // would make the control fail for a reason the real registry never gives.
    if (path === METADATA_PATH) {
      if (!authorized) {
        response.writeHead(404).end('{}');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          name: PACKAGE_NAME,
          'dist-tags': { latest: PACKAGE_VERSION },
          versions: {
            [PACKAGE_VERSION]: {
              name: PACKAGE_NAME,
              version: PACKAGE_VERSION,
              dist: { shasum, integrity, tarball: `http://127.0.0.1:${String(port)}${TARBALL_PATH}` },
            },
          },
        }),
      );
      return;
    }
    if (path === TARBALL_PATH) {
      if (!authorized) {
        response.writeHead(404).end('Not Found');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(tgz);
      return;
    }
    response.writeHead(404).end('Not Found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the fixture registry did not bind a port');
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Attempt {
  readonly code: number | null;
  readonly output: string;
  readonly installed: boolean;
  readonly requests: readonly Request[];
}

/**
 * The install is **asynchronous**, and that is not a style choice.
 *
 * The fixture registry is an `http.Server` in this same process, so a
 * `spawnSync` would block the event loop that has to answer its requests: pnpm
 * waits on a server that cannot run until pnpm exits. The first draft of this
 * file deadlocked exactly that way.
 */
async function install(npmrc: string): Promise<Attempt> {
  requests = [];
  const dir = mkdtempSync(join(tmpdir(), 'endora-npmrc-effect-'));
  const store = join(dir, '.store');
  mkdirSync(store, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'consumer',
        version: '0.0.0',
        private: true,
        dependencies: { [PACKAGE_NAME]: `^${PACKAGE_VERSION}` },
      },
      null,
      2,
    )}\n`,
  );
  // `ignore-workspace` for the acceptance criterion's reason: the temporary
  // directory must not be adopted by any workspace above it.
  writeFileSync(join(dir, '.npmrc'), `${npmrc}ignore-workspace=true\n`);

  const environment: NodeJS.ProcessEnv = { ...process.env, [TOKEN_VARIABLE]: 'fixture-token-not-a-real-one' };
  // The outer run is itself under pnpm, and its `npm_config_*` variables are
  // configuration for *that* install. Left in place they would decide this one.
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase().startsWith('npm_config_')) delete environment[key];
  }

  const child = spawn('pnpm', ['install', '--no-frozen-lockfile', '--store-dir', store], {
    cwd: dir,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const code = await new Promise<number | null>((resolve, reject) => {
    // A missing pnpm is a run that could not measure, and it fails rather than
    // passes: this file's whole value is that it executes the install.
    child.on('error', (error: Error) =>
      reject(new Error(`pnpm could not be run, so the effect was not measured: ${error.message}`)),
    );
    child.on('close', (status) => resolve(status));
  });
  return {
    code,
    output,
    installed: existsSync(join(dir, 'node_modules', PACKAGE_NAME, 'package.json')),
    requests: [...requests],
  };
}

describe('the auth lines, measured by an install against a registry shaped like GitLab', () => {
  it('is the control: the endpoint key alone leaves the tarball fetch unauthenticated', async () => {
    const endpoint = `http://127.0.0.1:${String(port)}${ENDPOINT_PATH}`;
    // The file as it was written before this repair: one auth line, keyed on
    // the configured endpoint.
    const previousShape =
      `@endora-commerce:registry=${endpoint}\n` +
      `//127.0.0.1:${String(port)}${ENDPOINT_PATH}:_authToken=\${${TOKEN_VARIABLE}}\n`;

    const attempt = await install(previousShape);

    const metadata = attempt.requests.filter((entry) => entry.path === METADATA_PATH);
    const tarballs = attempt.requests.filter((entry) => entry.path === TARBALL_PATH);
    expect(metadata.length).toBeGreaterThan(0);
    expect(metadata.every((entry) => entry.authorized)).toBe(true);
    expect(tarballs.length).toBeGreaterThan(0);
    expect(tarballs.some((entry) => entry.authorized)).toBe(false);

    expect(attempt.installed).toBe(false);
    // The sentence the CI failure carried, from the same cause.
    expect(attempt.output).toContain('No authorization header was set for the request.');
  }, 120_000);

  it('sends the header for the tarball under the file this package writes today', async () => {
    const endpoint = `http://127.0.0.1:${String(port)}${ENDPOINT_PATH}`;
    const attempt = await install(npmrcContent(endpoint, ['@endora-commerce']));

    const tarballs = attempt.requests.filter((entry) => entry.path === TARBALL_PATH);
    expect(tarballs.length).toBeGreaterThan(0);
    expect(tarballs.every((entry) => entry.authorized)).toBe(true);

    expect(attempt.installed).toBe(true);
    expect(attempt.code).toBe(0);
  }, 120_000);
});
