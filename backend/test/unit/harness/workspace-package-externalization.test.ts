/**
 * `@endora-commerce/contracts` is loaded once by node, not once per test file
 * by vite-node (issue #199).
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
 * ## Why the rule names one package rather than `packages/*`
 *
 * Because the wider rule was tried, and it is not free. `@endora-commerce/platform`
 * owns process-wide registries — the tenant-scope classification list among
 * them — and externalizing it gives the whole shard **one** of each, while
 * vitest goes on re-evaluating every module that registers into them once per
 * test file. Measured over 32 files that import `pim_ergonode`'s entities:
 * inlined, `tenantClassifications()` held one entry per class and
 * `test/unit/pim_ergonode/tenant-classification.test.ts` passed; externalized,
 * it held 32 and that file failed ten times. **Past tense**: under D-257 that
 * file stopped reading the registry and moved into its own package, so the
 * measurement stands while its witness does not — widening this rule means
 * choosing a witness out of the callers that remain and measuring again.
 * Nothing about issue #199 requires
 * that change, and altering what a process-wide registry contains for a whole
 * run is a larger decision than this one — so the rule is the package the
 * measurement is about, and the platform is deliberately left where it was.
 *
 * The other four packages are untouched for the plainer reason that nothing
 * measured them.
 *
 * ## Why two assertions
 *
 * The behavioural one is the real guard: vite's SSR transform rewrites a
 * module's imports into `__vite_ssr_import_N__`, so a contracts function that
 * closes over one carries the rewrite in its own source text. That is a fact
 * about the module instance this run is executing, not about the
 * configuration. The second holds the rule's *scope* to what was measured, in
 * both directions.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { dataEnvelope } from '@endora-commerce/contracts';

import { backendTestOptions } from '../../../vitest.shared.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

function externalPatterns(): readonly RegExp[] {
  const external = backendTestOptions().server?.deps?.external ?? [];
  return external.filter((entry): entry is RegExp => entry instanceof RegExp);
}

function matches(entry: string): boolean {
  return externalPatterns().some((pattern) => pattern.test(entry));
}

describe('the contracts barrel this run executes was loaded by node, not by vite-node', () => {
  it('carries no SSR import rewrite in a function that closes over its own import', () => {
    const source = dataEnvelope.toString();

    expect(
      source.includes('__vite_ssr_import'),
      "`dataEnvelope` still carries vite's SSR import rewrite, which means " +
        '`@endora-commerce/contracts` is being inlined and re-evaluated once per test file. ' +
        'Restore `server.deps.external` in backend/vitest.shared.ts — see issue #199 and the ' +
        `comment there. Source: ${source}`,
    ).toBe(false);
  });
});

describe('the externalization rule covers what was measured, and no more', () => {
  it('is configured at all', () => {
    expect(externalPatterns().length).toBeGreaterThan(0);
  });

  it('matches the contracts build', () => {
    expect(matches(join(REPO_ROOT, 'packages', 'contracts', 'dist', 'index.js'))).toBe(true);
  });

  it('does not match the contracts sources — a test that reads them as text is untouched', () => {
    expect(matches(join(REPO_ROOT, 'packages', 'contracts', 'src', 'index.ts'))).toBe(false);
  });

  /**
   * The direction a widening would take, and the one that costs something. See
   * the header: externalizing the platform gives the shard one tenant-scope
   * classification registry while vitest re-evaluates every entity module per
   * file, which counted 32 registrations where 1 was expected. The file that
   * counted them has since moved into `pim_ergonode`'s own package and no
   * longer reads the registry (D-257), so the header's witness is historical —
   * see it for what re-measuring now requires.
   */
  it('does not match the platform build, whose registries are shared state', () => {
    expect(
      matches(join(REPO_ROOT, 'packages', 'platform', 'dist', 'kernel', 'index.js')),
      'externalizing @endora-commerce/platform gives the whole shard one copy of every ' +
        'process-wide registry it owns, while vitest goes on re-evaluating the modules that ' +
        'register into them once per test file. Measured: 32 entries where one is expected. ' +
        'If that is genuinely wanted, it is its own change, with its own measurement.',
    ).toBe(false);
  });
});
