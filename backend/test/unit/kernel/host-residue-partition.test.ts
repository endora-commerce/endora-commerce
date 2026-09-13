import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveModuleLayout } from '../../../scripts/lib/module-roots.js';
import { coveredArtifactPaths } from '../../../scripts/check-overlay-determinism.js';
import { deploymentRoot, deploymentsOnDisk } from '../../../src/overlay/overlay-roots.js';
import {
  partitionHostResidue,
  type ClassifiedFile,
  type HostFileClass,
  type HostResidueInput,
} from '../../helpers/host-residue.js';

/**
 * `backend/src` holds the residue, and the residue is asserted rather than
 * claimed (`specs/110-instance-repository/` T11A, SC-007).
 *
 * ## What is being asserted
 *
 * SC-007 reads: *"`backend/src` in **this** repository holds no file a client
 * must never edit: after FR-013 it holds the entry points, the five generated
 * artefacts, the dev seeds and the two reference deployments, and nothing else.
 * **Derived, never listed** — the residue is what `research.md` §3.1's third
 * class enumerates."*
 *
 * That sentence is prose *about* a partition, and a test that spelled its list
 * back would pass today and learn nothing the next time a file lands: somebody
 * adds a line, and the assertion has been told the answer instead of deriving
 * it. This estate has produced that shape seven times in a week, every one of
 * them found by the next piece of work rather than by the one that caused it
 * (D-100). So the classes are derived, from the rule the enumerated files are
 * instances *of* — `operator-half.md` §1, quoted in full in
 * `test/helpers/host-residue.ts`, which holds the analysis so that each red
 * proof below enters at the **top** of it (issue #130).
 *
 * ## The three classes, and the one that fails
 *
 * `research.md` §3.1 classifies the whole of `backend/src` into three:
 * **shims**, which forward to the platform and retire with the reaches they
 * carry; the **residual**, which stays; and the **platform-shaped**, which is
 * *the move*. The first two are where a file may be. The third is debt — a file
 * a client must never edit, sitting in the tree SC-007 is about — and this file
 * carries it as {@link PLATFORM_SHAPED_RESIDUE}, two-way and expected to empty.
 *
 * **The ledger decides no class**, and that distinction is the whole reason it
 * is allowed to exist here: every one of the classifications below is derived
 * from the file, and an entry can neither put a file in the residual class nor
 * take one out of it. What it records is that a *derived* platform-shaped
 * membership is inherited debt with a retiring condition. A file that is neither
 * a shim nor residual and is not already ledgered fails; a ledgered file that
 * moved fails too, in the merge request that moved it.
 *
 * ## The refusals
 *
 * A green here must not be able to mean "not looking" (issue #113), and the
 * dangerous silence is **not** an empty walk — that reports every file in no
 * class, loudly. It is an *author* going quiet while the file count stays healthy, at
 * which point every file that author would have classified lands in somebody
 * else's class and the report is entirely wrong (#237's shape). So each of the
 * three external authors is reconciled against the population and a shortfall
 * refuses, and the syntax walk carries a floor of its own.
 */

/**
 * `research.md` §3.1's second class — *"platform-shaped — the move"* — what is
 * left of it, and what retires each entry.
 *
 * It is not a classification and cannot be used as one: a file appears here only
 * once the analysis has *derived* that it holds code and names no path in this
 * tree. Both directions fail — an unledgered platform-shaped file is new debt,
 * and an entry naming a file the analysis no longer puts in that class is an
 * entry describing nothing.
 *
 * **A `retiredBy` is the condition as it was understood when the entry was
 * written, and never a commitment.** `backend/src/overlay/divergence-report.ts`
 * was ledgered here with *"the `overlay/` half of FR-013"* — a move into
 * `@endora-commerce/platform` — and `specs/110-instance-repository/` T138a moved
 * it into `@endora-commerce/cli` instead, with the derivation that feeds it: the
 * report has a second host, a client's instance renders one over its own `apps/`
 * tree, and a renderer has no runtime reader that would justify the platform —
 * a runtime dependency of every instance — carrying it. The entry retired by
 * being deleted, which is the only way an entry here retires; what changed was
 * the destination, not the verdict that the file did not belong in `backend/src`.
 */
const PLATFORM_SHAPED_RESIDUE: Readonly<Record<string, { reason: string; retiredBy: string }>> = {
  'backend/src/cli/demo-command.ts': {
    reason:
      "the host's side of `endora demo seed` / `endora demo reset`. It names no path in this tree " +
      '— its three imports are two bare specifiers and the `module-commands.ts` shim beside it — ' +
      "so `operator-half.md` §1 puts it in the platform. `research.md` §3.1 files it exactly there: " +
      '*"`demo-command.ts` (137) arrived with `specs/113-module-owned-demo-data/` Phase 0, after ' +
      'this row was written, and is the same class by `operator-half.md` §1.1\'s rule — T117 moved ' +
      'its own subject and left it."*',
    retiredBy:
      "the move of the command body to `@endora-commerce/platform`, on the shape the five `module:*` " +
      'verbs already take: the logic in the package, a ~20-line entry point in the application. ' +
      '`specs/113-module-owned-demo-data/` owns the follow-up.',
  },
};

/** Every file under a directory, absolute, sorted. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out.sort();
}

/**
 * The paths a `backend/package.json` script spawns, as source paths.
 *
 * The manifest is the author, and it is asked in the two dialects it writes:
 * `tsx src/index.ts` names the source, `node dist/index.js` names what `tsc`
 * emitted from it — and both are the same operator-facing address, which is
 * `operator-half.md` §1.1's class. `dev`/`worker:dev` reach theirs through
 * `scripts/dev.mjs <path>`, so the path is read off the command line rather than
 * off the runner's name.
 */
function entryPointsFrom(manifest: string, applicationRoot: string): string[] {
  const scripts = (JSON.parse(manifest) as { scripts?: Record<string, string> }).scripts ?? {};
  const found = new Set<string>();
  for (const command of Object.values(scripts)) {
    for (const match of command.matchAll(/(?:^|[\s'"=])((?:src|dist)\/[\w./-]+\.(?:ts|mts|cts|js|mjs))/g)) {
      const named = match[1] ?? '';
      const source = named.startsWith('dist/')
        ? `src/${named.slice('dist/'.length).replace(/\.[cm]?js$/, '.ts')}`
        : named;
      found.add(resolve(applicationRoot, source));
    }
  }
  return [...found].sort();
}

async function realInput(): Promise<HostResidueInput> {
  const layout = await resolveModuleLayout();
  const sourceRoot = layout.srcRoot;
  // A fifth refusal, and it is the one that would be quiet: the shim class is
  // decided against the platform's two spellings, so a workspace that resolves
  // neither reports the whole bridge as platform-shaped — a report about the
  // walk, dressed as a report about the tree. How many that is is not written
  // here; the run prints it (D-100).
  if (layout.platformRoot === null || layout.platformPackageName === null) {
    throw new Error(
      'this workspace declares no `endora.type: "platform"` member, so no file under ' +
        '`backend/src` can be classified as a re-export shim; refusing rather than reporting ' +
        'the whole bridge as debt',
    );
  }
  const files = new Map<string, string>();
  for (const path of walk(sourceRoot)) files.set(path, readFileSync(path, 'utf8'));
  return {
    repoRoot: layout.repoRoot,
    applicationRoot: layout.applicationRoot,
    sourceRoot,
    // The package directory, not its source root: a shim spells its forward as
    // `../../../packages/platform/dist/…`, which is under the package and under
    // neither `src` nor any barrel.
    platformPackageRoot: resolve(layout.platformRoot, '..'),
    platformPackageName: layout.platformPackageName,
    files,
    generatedArtefacts: coveredArtifactPaths(),
    entryPoints: entryPointsFrom(
      readFileSync(join(layout.applicationRoot, 'package.json'), 'utf8'),
      layout.applicationRoot,
    ),
    // The application's **one** derivation of where deployments are (D115-3,
    // `contracts/application-root-supplier.md` R1.1). Asking the filesystem here
    // would be a second answer waiting to disagree with it.
    deploymentRoots: deploymentsOnDisk().map((name) => join(deploymentRoot(), 'apps', name)),
  };
}

/** A fixture input: everything absolute, nothing on disk. */
function fixture(overrides: Partial<HostResidueInput> & { files: ReadonlyMap<string, string> }): HostResidueInput {
  const repoRoot = `${sep}repo`;
  const applicationRoot = join(repoRoot, 'backend');
  return {
    repoRoot,
    applicationRoot,
    sourceRoot: join(applicationRoot, 'src'),
    platformPackageRoot: join(repoRoot, 'packages', 'platform'),
    platformPackageName: '@endora-commerce/platform',
    generatedArtefacts: [],
    entryPoints: [],
    deploymentRoots: [],
    ...overrides,
  };
}

function fixtureFiles(entries: Readonly<Record<string, string>>): Map<string, string> {
  const files = new Map<string, string>();
  for (const [path, text] of Object.entries(entries)) files.set(join(`${sep}repo`, path), text);
  return files;
}

const result = partitionHostResidue(await realInput());

const byClass = (klass: Exclude<HostFileClass, null>): ClassifiedFile[] =>
  result.files.filter((file) => file.klass === klass);

describe('`backend/src` — the residue, derived', () => {
  it('reports what it read, in one line', () => {
    const { generatedArtefacts, entryPoints, deploymentRoots } = result.sources;
    process.stdout.write(
      `[host-residue] read: files=${result.files.length} sites=${result.parsed} ` +
        `sources=generated-artefacts:${generatedArtefacts.covered}/${generatedArtefacts.declared},` +
        `entry-points:${entryPoints.covered}/${entryPoints.declared},` +
        `deployments:${deploymentRoots.covered}/${deploymentRoots.declared} ` +
        `shim=${byClass('shim').length} residual=${byClass('residual').length} ` +
        `platform-shaped=${byClass('platform-shaped').length}\n`,
    );
    expect(result.files.length).toBeGreaterThan(0);
  });

  it('puts every file in a class, and a file in none is the failure', () => {
    const unclassified = result.files.filter((file) => file.klass === null);
    expect(
      unclassified.map((file) => `${file.path} — ${file.evidence}`),
      'A file under `backend/src` that neither forwards to the platform nor names a path in this ' +
        'tree. Give it a class by what it is: publish what it needs as a parameter and it is the ' +
        "platform's; name the tree it belongs to and it is the residue. Do not add it to a list.",
    ).toEqual([]);
  });

  it('holds the entry points, the generated artefacts, the seeds and the two reference deployments', () => {
    // Not an enumeration of paths — an assertion that each of SC-007's four
    // nouns is a reading the analysis *derived* somewhere in the tree. A reading
    // that produced nothing is a reading that has stopped working, and the two
    // seed files are the ones `names-this-tree` answers for.
    const readings = [...new Set(byClass('residual').map((file) => file.reading))].sort();
    for (const reading of ['deployment', 'entry-point', 'generated', 'names-this-tree'] as const) {
      expect(readings, `no file in the residue answers '${reading}'`).toContain(reading);
    }
  });

  it('keeps `research.md` §3.1\'s second class to what is ledgered, both ways', () => {
    const derived = byClass('platform-shaped').map((file) => file.path).sort();
    const ledgered = Object.keys(PLATFORM_SHAPED_RESIDUE).sort();

    const unledgered = derived.filter((path) => !ledgered.includes(path));
    expect(
      unledgered,
      'A file in `backend/src` that holds code and names no path in this tree is a file a client ' +
        'must never edit, sitting where SC-007 says nothing of the sort is left. That is the fork ' +
        'D-207 refuses, arriving one file at a time. Move it into `@endora-commerce/platform`, or ' +
        'ledger it with what retires it.',
    ).toEqual([]);

    const stale = ledgered.filter((path) => !derived.includes(path));
    expect(
      stale,
      'A ledger entry describing a file the analysis no longer puts in the second class. Delete it ' +
        'in the merge request that moved the file.',
    ).toEqual([]);

    for (const [path, entry] of Object.entries(PLATFORM_SHAPED_RESIDUE)) {
      expect(entry.reason.length, `${path} carries no reason`).toBeGreaterThan(80);
      expect(entry.retiredBy.length, `${path} names nothing that retires it`).toBeGreaterThan(40);
    }
  });

  describe('refusals — a green may not mean "not looking"', () => {
    it('refuses a population that came back empty', () => {
      expect(result.files.length).toBeGreaterThan(0);

      const empty = partitionHostResidue(fixture({ files: new Map() }));
      expect(empty.files).toEqual([]);
    });

    it('refuses a walk that opened files and parsed none', () => {
      // #237's shape: `files` stays healthy while the syntax walk goes blind, so
      // every shim reads as platform-shaped and every reading below the syntax
      // ones stops firing. The file count cannot see it; `sites` can.
      expect(result.parsed).toBeGreaterThan(0);

      const blind = partitionHostResidue(
        fixture({ files: fixtureFiles({ 'backend/src/notes.md': 'nothing here' }) }),
      );
      expect(blind.parsed).toBe(0);
    });

    it('refuses each author that named a path the walk did not produce', () => {
      for (const [name, coverage] of Object.entries(result.sources)) {
        expect(coverage.declared, `${name}: this author named nothing under the source root`).toBeGreaterThan(0);
        expect(coverage.missing, `${name}: named a path the walk did not produce`).toEqual([]);
      }

      const short = partitionHostResidue(
        fixture({
          files: fixtureFiles({ 'backend/src/index.ts': 'export const x = 1;\n' }),
          generatedArtefacts: [join(`${sep}repo`, 'backend/src/gone.generated.ts')],
          entryPoints: [join(`${sep}repo`, 'backend/src/also-gone.ts')],
          deploymentRoots: [join(`${sep}repo`, 'backend/src/apps/example')],
        }),
      );
      expect(short.sources.generatedArtefacts).toEqual({
        declared: 1,
        covered: 0,
        missing: ['backend/src/gone.generated.ts'],
      });
      expect(short.sources.entryPoints.missing).toEqual(['backend/src/also-gone.ts']);
      expect(short.sources.deploymentRoots.missing).toEqual(['backend/src/apps/example']);
    });
  });

  describe('red proofs — one per class, entering at the top of the analysis', () => {
    it('a file in no class', () => {
      const found = partitionHostResidue(
        fixture({
          files: fixtureFiles({
            'backend/src/index.ts': 'export const x = 1;\n',
            'backend/src/stray.json': '{ "unrelated": true }\n',
          }),
          entryPoints: [join(`${sep}repo`, 'backend/src/index.ts')],
        }),
      );
      expect(found.files.filter((file) => file.klass === null).map((file) => file.path)).toEqual([
        'backend/src/stray.json',
      ]);
    });

    it('a shim, in both spellings — the bare subpath and the reach into `dist`', () => {
      const found = partitionHostResidue(
        fixture({
          files: fixtureFiles({
            'backend/src/tenancy/index.ts': "export * from '@endora-commerce/platform/tenancy';\n",
            'backend/src/kernel/scope.ts':
              "export * from '../../../packages/platform/dist/kernel/scope.js';\n",
          }),
        }),
      );
      expect(found.files.map((file) => file.klass)).toEqual(['shim', 'shim']);
    });

    it('a file that re-exports something other than the platform is not a shim', () => {
      // `overlay/types.ts` is the live case: it forwards, but one of its targets
      // is `@endora-commerce/contracts`, so it is not the bridge and does not
      // drain with one.
      const found = partitionHostResidue(
        fixture({
          files: fixtureFiles({
            'backend/src/overlay/types.ts':
              "export type { A } from '@endora-commerce/contracts';\n" +
              "export type { B } from '@endora-commerce/platform/overlay';\n",
          }),
        }),
      );
      expect(found.files[0]?.klass).toBe('platform-shaped');
    });

    it('residual — each of the seven readings, one file each', () => {
      const at = (path: string): string => join(`${sep}repo`, path);
      const found = partitionHostResidue(
        fixture({
          files: fixtureFiles({
            'backend/src/thing.generated.ts': "export { x } from './pinned.js';\n",
            'backend/src/pinned.ts': 'export const x = 1;\n',
            'backend/src/index.ts': "import './locator.js';\n",
            'backend/src/apps/example/divergence.ts': 'export const declaration = {};\n',
            'backend/src/locator.ts': 'export const here = import.meta.url;\n',
            'backend/src/seeds/rows.ts':
              "import type { R } from '../../../packages/modules/catalog/dist/backend/entities/r.js';\n" +
              'export const rows: R[] = [];\n',
            'backend/src/binding.ts': "export { x } from './pinned.js';\n",
          }),
          generatedArtefacts: [at('backend/src/thing.generated.ts')],
          entryPoints: [at('backend/src/index.ts')],
          deploymentRoots: [at('backend/src/apps/example')],
        }),
      );
      const readings = new Map(found.files.map((file) => [file.path, file.reading]));
      expect(readings.get('backend/src/thing.generated.ts')).toBe('generated');
      expect(readings.get('backend/src/index.ts')).toBe('entry-point');
      expect(readings.get('backend/src/apps/example/divergence.ts')).toBe('deployment');
      expect(readings.get('backend/src/locator.ts')).toBe('locates-itself');
      expect(readings.get('backend/src/seeds/rows.ts')).toBe('names-this-tree');
      expect(readings.get('backend/src/pinned.ts')).toBe('named-by-an-artefact');
      expect(readings.get('backend/src/binding.ts')).toBe('reaches-the-residue');
      expect(found.files.every((file) => file.klass === 'residual')).toBe(true);
    });

    it('a non-source file is asked the same question of its text', () => {
      const found = partitionHostResidue(
        fixture({
          files: fixtureFiles({
            'backend/src/modules/README.md': 'No module lives in `backend/src/modules` any more.\n',
            'backend/src/elsewhere/README.md': 'A note about nothing in particular.\n',
          }),
        }),
      );
      const byPath = new Map(found.files.map((file) => [file.path, file]));
      expect(byPath.get('backend/src/modules/README.md')?.reading).toBe('names-this-tree');
      expect(byPath.get('backend/src/elsewhere/README.md')?.klass).toBeNull();
    });

    it('platform-shaped — code that names nothing, and a shim does not conduct', () => {
      const found = partitionHostResidue(
        fixture({
          files: fixtureFiles({
            'backend/src/cli/module-commands.ts': "export * from '@endora-commerce/platform/cli';\n",
            'backend/src/cli/demo-command.ts':
              "import { E } from './module-commands.js';\nexport const run = (): typeof E => E;\n",
          }),
        }),
      );
      const byPath = new Map(found.files.map((file) => [file.path, file.klass]));
      expect(byPath.get('backend/src/cli/module-commands.ts')).toBe('shim');
      expect(byPath.get('backend/src/cli/demo-command.ts')).toBe('platform-shaped');
    });

    it('a path quoted in prose is not a reach', () => {
      // Every specifier is read as a literal AST node, which is what keeps the
      // doc blocks in `backend/src` — most of which quote a path into
      // `packages/platform/dist` to explain why the file forwards there — out of
      // the population by construction rather than by an exclusion.
      const found = partitionHostResidue(
        fixture({
          files: fixtureFiles({
            'backend/src/prose.ts':
              "// This used to live at '../../../packages/platform/dist/kernel/scope.js'.\n" +
              'export const x = 1;\n',
          }),
        }),
      );
      expect(found.files[0]?.klass).toBe('platform-shaped');
    });
  });

  it('prints the residue, so a reader can disagree with a classification', () => {
    const lines = result.files
      .filter((file) => file.klass === 'residual')
      .map((file) => `  ${file.reading?.padEnd(20)} ${file.path}`)
      .sort();
    expect(lines.length).toBeGreaterThan(0);
    process.stdout.write(`[host-residue] residual (${lines.length}):\n${lines.join('\n')}\n`);
  });
});
