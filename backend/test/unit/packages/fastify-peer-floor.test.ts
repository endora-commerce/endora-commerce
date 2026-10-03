import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { runNewInstance } from '@endora-commerce/cli';
import { classifyWorkspaceMembers } from '@endora-commerce/cli/lib/workspace-packages.js';

import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { nodeManifestFs } from '../../../scripts/lib/module-package-manifest.js';

/**
 * No range a stranger's install reads may admit a Fastify older than 5.11.0.
 *
 * ## The defect this was written from
 *
 * On Fastify < 5.11 an async route handler that calls `reply.send()` without
 * `return` throws `ERR_HTTP_HEADERS_SENT` as an **uncaught exception** from the
 * onSend hook runner, and the process crash-loops. 5.11.0 added a try/catch in
 * `handleResolve` (`lib/hooks.js`), so the server survives the same handler —
 * measured against a real socket in
 * `test/contract/real-socket-reply-contract.test.ts`. This repository's
 * lockfile resolves 5.12.5, which is why nothing here ever showed it; a
 * published `fastify: "^5"` peer let a third-party install resolve 5.0–5.10.
 *
 * ## What is held
 *
 * Every published workspace package that declares `fastify` in a field a
 * consumer's install reads, and the range `endora new instance` writes into a
 * scaffolded instance — read from a real dry run, not from the source the
 * scaffold happens to copy today, so a second source added later is held too.
 * `devDependencies` are not read: a consumer never installs them.
 */

const FLOOR: readonly [number, number, number] = [5, 11, 0];
const CONSUMER_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

/**
 * The lowest version a single-comparator range admits, or `null` for a shape
 * this reader does not judge (`||`, a hyphen range, an upper bound, `*`, a
 * protocol). `null` is reported as a failure by the caller, never skipped.
 */
export function minimumOf(range: string): readonly [number, number, number] | null {
  const match = /^\s*(?:\^|~|>=|=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-[0-9A-Za-z.-]+)?\s*$/.exec(
    range,
  );
  if (match === null) return null;
  const part = (value: string | undefined): number =>
    value === undefined || value === 'x' || value === '*' ? 0 : Number(value);
  return [Number(match[1]), part(match[2]), part(match[3])];
}

/** Every non-test `.ts` source under `roots`, skipping installs and build output. */
function sourceFiles(roots: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(full);
    }
  };
  for (const root of roots) walk(root);
  return found;
}

function admitsBelowFloor(range: string): boolean {
  const minimum = minimumOf(range);
  if (minimum === null) return true;
  for (let index = 0; index < 3; index += 1) {
    if (minimum[index]! !== FLOOR[index]!) return minimum[index]! < FLOOR[index]!;
  }
  return false;
}

describe('minimumOf', () => {
  it('reads the lowest version of the shapes a manifest uses', () => {
    expect(minimumOf('^5')).toEqual([5, 0, 0]);
    expect(minimumOf('^5.11.0')).toEqual([5, 11, 0]);
    expect(minimumOf('5.x')).toEqual([5, 0, 0]);
    expect(minimumOf('>=5.11.0')).toEqual([5, 11, 0]);
    expect(minimumOf('~5.12')).toEqual([5, 12, 0]);
  });

  it('refuses to judge a shape it cannot bound from below', () => {
    expect(minimumOf('^4 || ^5.11.0')).toBeNull();
    expect(minimumOf('workspace:*')).toBeNull();
    expect(minimumOf('*')).toBeNull();
  });

  it('places the floor where the crash stops', () => {
    expect(admitsBelowFloor('^5')).toBe(true);
    expect(admitsBelowFloor('^5.10.9')).toBe(true);
    expect(admitsBelowFloor('^5.11.0')).toBe(false);
    expect(admitsBelowFloor('^5.12.5')).toBe(false);
  });
});

describe('fastify is never declared below 5.11.0 to a consumer', () => {
  it('in any published workspace package', () => {
    expect(repoRoot).not.toBeNull();
    const published = classifyWorkspaceMembers(repoRoot!, nodeManifestFs()).members.filter(
      (member) => member.family && member.manifest['private'] !== true,
    );
    const declaring: string[] = [];
    const below: string[] = [];
    for (const member of published) {
      for (const field of CONSUMER_FIELDS) {
        const block = member.manifest[field];
        if (block === null || typeof block !== 'object') continue;
        const range = (block as Record<string, unknown>)['fastify'];
        if (typeof range !== 'string') continue;
        declaring.push(member.name);
        if (admitsBelowFloor(range)) below.push(`${member.name} ${field}.fastify = ${range}`);
      }
    }
    // Not judging an empty population: the platform and the module packages peer on it.
    expect(declaring).toContain('@endora-commerce/platform');
    expect(declaring.length).toBeGreaterThan(10);
    expect(below).toEqual([]);
  });

  it('in the runtime version check of any fastify-plugin wrapper', () => {
    // `fastify-plugin`'s `fastify:` option is a semver range Fastify checks at
    // `register` time (`checkVersion` in `lib/plugin-utils.js`). It is a second
    // statement of the same floor, read by the running process rather than by
    // the installer, so a wrapper declaring `5.x` accepts the very releases the
    // manifest refuses. The floor's one source of truth is `PEER_FLOORS` in
    // `scripts/lib/module-package-manifest.ts`, which a module package cannot
    // import; this sweep is what holds the literals to it instead.
    const declared: string[] = [];
    for (const file of sourceFiles([join(repoRoot!, 'packages'), join(repoRoot!, 'backend', 'src')])) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes("from 'fastify-plugin'")) continue;
      for (const match of source.matchAll(/\bfastify:\s*['"]([^'"]+)['"]/g)) {
        declared.push(`${relative(repoRoot!, file)} fastify: ${match[1]}`);
      }
    }
    // Not judging an empty population: the auth plugin declares one.
    expect(declared.some((entry) => entry.startsWith('packages/modules/auth/'))).toBe(true);
    expect(declared.filter((entry) => admitsBelowFloor(entry.split('fastify: ')[1]!))).toEqual([]);
  });

  describe('in what a scaffolded instance declares', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'fastify-floor-'));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));

    it('written by a dry run of `endora new instance` against this checkout', async () => {
      const result = await runNewInstance({
        dir: join(scratch, 'acme-shop'),
        dryRun: true,
        cwd: join(repoRoot!, 'backend'),
      });
      const ranges: string[] = [];
      for (const file of result.plan.files) {
        if (!file.path.endsWith('package.json')) continue;
        const manifest = JSON.parse(file.content) as Record<string, unknown>;
        for (const field of [...CONSUMER_FIELDS, 'devDependencies'] as const) {
          const block = manifest[field];
          if (block === null || typeof block !== 'object') continue;
          const range = (block as Record<string, unknown>)['fastify'];
          if (typeof range === 'string') ranges.push(`${file.path} ${field}.fastify = ${range}`);
        }
      }
      expect(ranges.length).toBeGreaterThan(0);
      expect(ranges.filter((entry) => admitsBelowFloor(entry.split(' = ')[1]!))).toEqual([]);
    }, 60_000);
  });
});
