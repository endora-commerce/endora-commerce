/**
 * A workspace package's built output is loaded once by node, not once per test
 * file by vite-node (issue #199).
 *
 * ## What this is protecting
 *
 * `vite-node`'s `shouldExternalize` asks whether the resolved id contains
 * `/node_modules/`. A pnpm workspace link resolves through to the real
 * directory, so `@endora-commerce/contracts` arrives as
 * `<repo>/packages/contracts/dist/index.js` and is **inlined** — transformed
 * and re-evaluated for every test file that imports it. The whole backend suite
 * shares one process (`poolOptions.forks.singleFork`), so those evaluations
 * accumulate: measured on this repository, one evaluation of the contracts
 * barrel retains 111 MB, twelve test files produced ten of them, and 6.4 were
 * still reachable when the fork hit its 2 GB cap and took the rest of the shard
 * with it.
 *
 * ## Why two assertions and not one
 *
 * The behavioural one is the real guard and it can only speak for the package
 * this file imports: vite's SSR transform rewrites a module's imports into
 * `__vite_ssr_import_N__`, so a function that closes over one carries the
 * rewrite in its own source text. That is a fact about the module instance this
 * run is executing, not about the configuration — which is what makes it
 * unfoolable, and also what makes it single-package.
 *
 * The configuration one covers the rest, and is derived from the workspace
 * rather than from a list: every member whose manifest points at `./dist` must
 * be matched by the rule. A seventh package added under `packages/` is covered
 * on the day it arrives, and a rule narrowed to one package name fails here
 * instead of quietly halving the fix.
 */
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { dataEnvelope } from '@endora-commerce/contracts';

import { backendTestOptions } from '../../../vitest.shared.js';
import { nodeWorkspaceFs, workspaceMembers } from '../../../scripts/lib/workspace-packages.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

function externalPatterns(): readonly RegExp[] {
  const external = backendTestOptions().server?.deps?.external ?? [];
  return external.filter((entry): entry is RegExp => entry instanceof RegExp);
}

/** Members whose published entry point is a built `dist`, from their own manifests. */
function packagesResolvingToDist(): readonly { name: string; dir: string }[] {
  return workspaceMembers(REPO_ROOT, nodeWorkspaceFs())
    .filter((member) => JSON.stringify(member.manifest['exports'] ?? member.manifest['main'] ?? '').includes('/dist/'))
    .map((member) => ({ name: member.name, dir: member.dir }));
}

describe('the contracts barrel this run executes was loaded by node, not by vite-node', () => {
  it('carries no SSR import rewrite in a function that closes over its own import', () => {
    const source = dataEnvelope.toString();

    expect(
      source.includes('__vite_ssr_import'),
      '`dataEnvelope` still carries vite\'s SSR import rewrite, which means ' +
        '`@endora-commerce/contracts` is being inlined and re-evaluated once per test file. ' +
        'Restore `server.deps.external` in backend/vitest.shared.ts — see issue #199 and the ' +
        `comment there. Source: ${source}`,
    ).toBe(false);
  });
});

describe('every workspace package that ships a dist is externalized', () => {
  it('finds the packages to answer for — an empty set would make this vacuous', () => {
    expect(packagesResolvingToDist().length).toBeGreaterThan(0);
  });

  it('matches each of them with the rule the backend configs share', () => {
    const patterns = externalPatterns();
    expect(patterns.length, 'no regular-expression externalization rule is configured').toBeGreaterThan(0);

    const unmatched = packagesResolvingToDist()
      .filter(({ dir }) => {
        const entry = join(dir, 'dist', 'index.js');
        return !patterns.some((pattern) => pattern.test(entry));
      })
      .map(({ name, dir }) => `${name} (${relative(REPO_ROOT, dir)})`);

    expect(
      unmatched,
      'these workspace packages resolve to a built dist that vite-node would inline and ' +
        're-evaluate for every test file of the shard (issue #199)',
    ).toEqual([]);
  });
});
