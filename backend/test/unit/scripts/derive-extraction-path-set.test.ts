/**
 * `scripts/extract-paid-module.sh`'s path set, and the four things E3p says it
 * is — the companion test the extraction script did not have
 * (`specs/134-paid-module-extraction/contracts/extraction-procedure.md` **E3p**
 * and refusal 14; owner ruling **D-263**).
 *
 * ## Why a test, for a script that runs fifteen times and is then history
 *
 * Because the thing it got wrong was **silent**. Until 2026-09-22 the export's
 * path set was four hand-kept roots, and the export's only self-check was over
 * its own **tip** tree, which a truncated history passes. Three modules left
 * that way and nothing went red. So what is worth asserting here is not
 * `git filter-repo` — that is somebody else's program, and the run itself
 * proves it — but every place where this repository's **history** is turned
 * into a claim about which paths are the module's:
 *
 *   * **R1**, the manifest resolution over every commit: a directory whose
 *     manifest declared the id is a root, whichever era it sat in, and a
 *     directory whose manifest declared a *different* id is not.
 *   * **R2**, the rename closure of the package's own file set: every path a
 *     surviving file has ever **held**, and — the part that is a trap rather
 *     than a detail — *not* the source of a **copy**, which `--follow` reports
 *     in the same output and which is how the repository's root `LICENSE`
 *     arrives in a module's export with a destination that collides with the
 *     package's own.
 *   * **The ownership tie-break**, because `--follow` is a similarity heuristic
 *     and crosses a module boundary wherever one connector was written by
 *     adapting the previous one's file. A path carrying another module's id is
 *     printed and not carried; a path carrying no module's id is carried.
 *   * **The refusal**, which is the only part that keeps the other three
 *     honest: an id-bearing path of the source history that the resolution
 *     neither carried nor dispositioned stops the run.
 *
 * Every fixture below is a real git repository built in a temp directory, for
 * one reason: three of the four behaviours are properties of git's own rename
 * and copy detection, and a fake `git` would be this file asserting its own
 * idea of what `--follow` prints — which is exactly the mistake that produced
 * the four-root list.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  completenessRefusals,
  declaredManifestId,
  historicalPathsOf,
  renderPathsFile,
  resolveManifestRoots,
  resolveRenameClosure,
  splitByOwnership,
  type GitRunner,
} from '../../../scripts/derive-extraction-path-set.js';
import { pathCarriesModuleId } from '../../../scripts/lib/module-id-paths.js';

const SCRIPT = join(
  dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'extract-paid-module.sh',
);

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true });
});

interface Fixture {
  readonly root: string;
  readonly git: GitRunner;
  write: (path: string, content: string) => void;
  remove: (path: string) => void;
  move: (from: string, to: string) => void;
  commit: (message: string) => void;
}

function repo(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'endora-d263-'));
  created.push(root);
  const run = (args: readonly string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', root], { stdio: 'ignore' });
  run(['config', 'user.name', 'Fixture']);
  run(['config', 'user.email', 'fixture@example.test']);
  run(['config', 'commit.gpgsign', 'false']);
  return {
    root,
    git: run,
    write(path, content) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    },
    remove(path) {
      unlinkSync(join(root, path));
    },
    move(from, to) {
      const full = join(root, to);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, readFileSync(join(root, from), 'utf8'), 'utf8');
      unlinkSync(join(root, from));
    },
    commit(message) {
      run(['add', '-A']);
      run(['commit', '--quiet', '-m', message]);
    },
  };
}

const manifestSource = (id: string): string =>
  `import { defineModuleManifest } from '@endora-commerce/platform/modules';\n\n` +
  `export const manifest = defineModuleManifest({\n  id: '${id}',\n  name: '${id}',\n});\n`;

/**
 * The two eras and the four crossings, in one repository:
 *
 *   1. `other_mod` is born a package, with a file `demo_mod` later adapts.
 *   2. `demo_mod` is born under `backend/src/modules/`, with satellites in every
 *      convention the estate has ever put them in.
 *   3. The packaging migration renames it into `packages/modules/`, and the
 *      root `LICENSE` is **copied** into the package.
 *   4. Two core-owned test files rename **in** to the package.
 *   5. `other_mod`'s file is deleted and reappears inside `demo_mod` — a real
 *      rename, across a module boundary, which is what the tie-break is for.
 */
function twoEraRepo(): Fixture {
  const f = repo();
  const licence = `MIT License\n\n${'Permission is hereby granted, free of charge.\n'.repeat(8)}`;
  f.write('LICENSE', licence);
  f.write('packages/modules/other_mod/src/manifest.ts', manifestSource('other_mod'));
  f.write(
    'packages/modules/other_mod/src/shared-thing.ts',
    `export function sharedThing(): string {\n  return 'a body long enough for rename detection to score it';\n}\n`,
  );
  f.commit('feat(other_mod): the module a later one was adapted from');

  f.write('backend/src/modules/demo_mod/manifest.ts', manifestSource('demo_mod'));
  f.write(
    'backend/src/modules/demo_mod/services/thing.ts',
    `export const thing = 'the module own service, in the pre-packaging era';\n`,
  );
  f.write(
    'backend/test/helpers/scripted-demo-client.ts',
    `export const scriptedDemoClient = { calls: [] as string[], note: 'names no module id anywhere' };\n`,
  );
  f.write(
    'backend/test/unit/demo_mod/host-bound.test.ts',
    `import { it } from 'vitest';\nit('boots the host', () => {});\n`,
  );
  f.write(
    'backend/test/unit/demo_mod/moves-in.test.ts',
    `import { it } from 'vitest';\nit('covers one service and travels with it', () => {});\n`,
  );
  f.write('docs/docs/module-reference/demo-mod.md', '# demo-mod\n\nGenerated.\n');
  f.write(
    'backend/scripts/ledgers/cross-module-imports/demo_mod.ts',
    `export const entries = {};\n`,
  );
  f.write('specs/999-demo/demo_mod.md', '# The design record\n');
  f.write('storefront/src/demo_mod/widget.ts', `export const widget = 'a storefront fragment';\n`);
  f.commit('feat(demo_mod): the module, in the pre-packaging era');

  f.move('backend/src/modules/demo_mod/manifest.ts', 'packages/modules/demo_mod/src/manifest.ts');
  f.move(
    'backend/src/modules/demo_mod/services/thing.ts',
    'packages/modules/demo_mod/src/backend/services/thing.ts',
  );
  f.write('packages/modules/demo_mod/LICENSE', licence);
  f.commit('refactor: the packaging migration');

  f.move(
    'backend/test/helpers/scripted-demo-client.ts',
    'packages/modules/demo_mod/src/test-support/scripted-demo-client.ts',
  );
  f.move(
    'backend/test/unit/demo_mod/moves-in.test.ts',
    'packages/modules/demo_mod/src/backend/services/moves-in.test.ts',
  );
  f.commit('test(demo_mod): the module owned tests move into the package');

  f.remove('packages/modules/other_mod/src/shared-thing.ts');
  f.write(
    'packages/modules/demo_mod/src/backend/services/shared-thing.ts',
    `export function sharedThing(): string {\n  return 'a body long enough for rename detection to score it';\n}\n`,
  );
  f.commit('refactor(demo_mod): the adapted file, which git reads as a rename');
  return f;
}

function trackedFiles(f: Fixture, dir: string): string[] {
  return f
    .git(['ls-tree', '-r', '--name-only', 'HEAD', '--', `${dir}/`])
    .split('\n')
    .filter((line) => line.length > 0);
}

describe('the FR-011(d) predicate, which has one home and two instruments', () => {
  it('reads a whole path segment and a filename stem, in either spelling', () => {
    expect(pathCarriesModuleId('backend/test/unit/demo_mod/x.test.ts', 'demo_mod')).toBe(true);
    expect(pathCarriesModuleId('admin/src/modules/demo-mod/index.ts', 'demo_mod')).toBe(true);
    expect(pathCarriesModuleId('docs/docs/modules/demo_mod.md', 'demo_mod')).toBe(true);
    expect(pathCarriesModuleId('docs/docs/module-reference/demo-mod.md', 'demo_mod')).toBe(true);
    expect(pathCarriesModuleId('admin/test/modules/demo-mod.surface.test.tsx', 'demo_mod')).toBe(
      true,
    );
  });

  it('does not read the id out of the middle of a filename', () => {
    // `backend/test/helpers/scripted-xl-client.ts` is `comarch_xl`'s and says
    // so nowhere. That is R2's job, and it is deliberately not this
    // predicate's: widening the predicate to a substring makes every
    // `scripted-*` helper in the tree everybody's.
    expect(pathCarriesModuleId('backend/test/helpers/scripted-demo-client.ts', 'demo_mod')).toBe(
      false,
    );
    expect(pathCarriesModuleId('backend/test/helpers/demo-mod-webhook.ts', 'demo_mod')).toBe(false);
    expect(pathCarriesModuleId('packages/modules/demo_module/src/x.ts', 'demo_mod')).toBe(false);
  });
});

describe('R1 — the manifest, over every commit', () => {
  it('resolves both eras from the history, and no directory convention', () => {
    const f = twoEraRepo();
    const resolution = resolveManifestRoots({ git: f.git, ref: 'HEAD', moduleId: 'demo_mod' });
    expect(resolution.roots).toEqual([
      'backend/src/modules/demo_mod',
      'packages/modules/demo_mod',
    ]);
  });

  it('computes the id population the tie-break is read against', () => {
    const f = twoEraRepo();
    const resolution = resolveManifestRoots({ git: f.git, ref: 'HEAD', moduleId: 'demo_mod' });
    expect([...resolution.idPopulation].sort()).toEqual(['demo_mod', 'other_mod']);
  });

  it('does not make another module a root of this one', () => {
    const f = twoEraRepo();
    const resolution = resolveManifestRoots({ git: f.git, ref: 'HEAD', moduleId: 'other_mod' });
    expect(resolution.roots).toEqual(['packages/modules/other_mod']);
  });

  it('reads the id a manifest declares about itself, and nothing else in it', () => {
    expect(declaredManifestId(manifestSource('demo_mod'))).toBe('demo_mod');
    expect(
      declaredManifestId(
        `${manifestSource('demo_mod')}\nexport const action = { id: 'open-demo' };\n`,
      ),
    ).toBe('demo_mod');
    expect(declaredManifestId('export const notAManifest = { id: 1 };\n')).toBeNull();
  });
});

describe('R2 — the rename closure of the package own file set', () => {
  it('finds a path no convention names, and yields its destination', () => {
    const f = twoEraRepo();
    const closure = resolveRenameClosure({
      git: f.git,
      ref: 'HEAD',
      files: trackedFiles(f, 'packages/modules/demo_mod'),
    });
    expect(closure.entries).toContainEqual({
      historical: 'backend/test/helpers/scripted-demo-client.ts',
      tip: 'packages/modules/demo_mod/src/test-support/scripted-demo-client.ts',
    });
    expect(closure.entries).toContainEqual({
      historical: 'backend/test/unit/demo_mod/moves-in.test.ts',
      tip: 'packages/modules/demo_mod/src/backend/services/moves-in.test.ts',
    });
  });

  it('stops at a copy, because a copied file never held the source path', () => {
    // The repository root `LICENSE` is byte-identical to the package's, so
    // `--follow` reports `C100` and then goes on reporting the *root* file's
    // own history. Carried, the export gains that file's unrelated commits and
    // its **root** becomes the repository's licence commit rather than the
    // module's birth — measured on `wfirma`, 30 commits rooted at `8cc26d6`
    // against 29 rooted at `15f75e9`, with the tip tree identical either way,
    // which is why nothing downstream of the export would have reported it.
    const f = twoEraRepo();
    const closure = resolveRenameClosure({
      git: f.git,
      ref: 'HEAD',
      files: trackedFiles(f, 'packages/modules/demo_mod'),
    });
    expect(closure.entries.map((e) => e.historical)).not.toContain('LICENSE');
    expect(closure.copyStops).toContainEqual({
      source: 'LICENSE',
      into: 'packages/modules/demo_mod/LICENSE',
    });
  });
});

describe('the ownership tie-break, which is the module population and not a judgement', () => {
  it('prints another module lineage rather than carrying it', () => {
    const f = twoEraRepo();
    const resolution = resolveManifestRoots({ git: f.git, ref: 'HEAD', moduleId: 'demo_mod' });
    const closure = resolveRenameClosure({
      git: f.git,
      ref: 'HEAD',
      files: trackedFiles(f, 'packages/modules/demo_mod'),
    });
    const split = splitByOwnership({
      entries: closure.entries,
      roots: resolution.roots,
      moduleId: 'demo_mod',
      idPopulation: resolution.idPopulation,
    });
    expect(split.foreign).toEqual([
      {
        historical: 'packages/modules/other_mod/src/shared-thing.ts',
        owner: 'other_mod',
        tip: 'packages/modules/demo_mod/src/backend/services/shared-thing.ts',
      },
    ]);
    expect(split.carried.map((e) => e.historical)).not.toContain(
      'packages/modules/other_mod/src/shared-thing.ts',
    );
  });

  it('carries a path that names no module at all', () => {
    const f = twoEraRepo();
    const resolution = resolveManifestRoots({ git: f.git, ref: 'HEAD', moduleId: 'demo_mod' });
    const closure = resolveRenameClosure({
      git: f.git,
      ref: 'HEAD',
      files: trackedFiles(f, 'packages/modules/demo_mod'),
    });
    const split = splitByOwnership({
      entries: closure.entries,
      roots: resolution.roots,
      moduleId: 'demo_mod',
      idPopulation: resolution.idPopulation,
    });
    expect(split.carried.map((e) => e.historical)).toContain(
      'backend/test/helpers/scripted-demo-client.ts',
    );
  });
});

describe('the refusal, which is what stops this becoming a list again', () => {
  function report(f: Fixture) {
    const resolution = resolveManifestRoots({ git: f.git, ref: 'HEAD', moduleId: 'demo_mod' });
    const closure = resolveRenameClosure({
      git: f.git,
      ref: 'HEAD',
      files: trackedFiles(f, 'packages/modules/demo_mod'),
    });
    const split = splitByOwnership({
      entries: closure.entries,
      roots: resolution.roots,
      moduleId: 'demo_mod',
      idPopulation: resolution.idPopulation,
    });
    return completenessRefusals({
      historicalPaths: historicalPathsOf({ git: f.git, ref: 'HEAD' }),
      moduleId: 'demo_mod',
      roots: resolution.roots,
      carried: split.carried,
    });
  }

  it('fires on an id-bearing path the resolution did not reach', () => {
    const f = twoEraRepo();
    expect(report(f).refused).toEqual(['storefront/src/demo_mod/widget.ts']);
  });

  it('walks the whole history, not the tip', () => {
    const f = twoEraRepo();
    const paths = historicalPathsOf({ git: f.git, ref: 'HEAD' });
    expect(paths).toContain('backend/test/unit/demo_mod/host-bound.test.ts');
    expect(paths).toContain('backend/src/modules/demo_mod/manifest.ts');
  });

  it('dispositions the four classes E3p rules, rather than stopping on them', () => {
    const f = twoEraRepo();
    const byPath = new Map(report(f).dispositioned.map((d) => [d.path, d.disposition]));
    expect(byPath.get('specs/999-demo/demo_mod.md')).toBe('design-record');
    expect(byPath.get('docs/docs/module-reference/demo-mod.md')).toBe('generated-reference-page');
    expect(byPath.get('backend/scripts/ledgers/cross-module-imports/demo_mod.ts')).toBe(
      'ledger-shard',
    );
    expect(byPath.get('backend/test/unit/demo_mod/host-bound.test.ts')).toBe('host-bound-test');
  });

  it('does not refuse a path the resolution carried', () => {
    const f = twoEraRepo();
    const refused = report(f).refused;
    expect(refused).not.toContain('backend/test/unit/demo_mod/moves-in.test.ts');
    expect(refused).not.toContain('backend/src/modules/demo_mod/services/thing.ts');
  });
});

describe('the plan handed to git-filter-repo', () => {
  it('puts every keep line before every rename, because a filter reads the renamed path', () => {
    const rendered = renderPathsFile({
      keep: ['packages/modules/demo_mod/', 'backend/test/unit/demo_mod/moves-in.test.ts'],
      renames: [
        { from: 'packages/modules/demo_mod/', to: 'modules/demo_mod/' },
        {
          from: 'backend/test/unit/demo_mod/moves-in.test.ts',
          to: 'modules/demo_mod/src/backend/services/moves-in.test.ts',
        },
      ],
    });
    const lines = rendered.split('\n').filter((l) => l.length > 0 && !l.startsWith('#'));
    const firstRename = lines.findIndex((l) => l.includes('==>'));
    expect(firstRename).toBeGreaterThan(0);
    expect(lines.slice(0, firstRename).some((l) => l.includes('==>'))).toBe(false);
    // Longest source first: a directory rule applied first would eat the file
    // rule's prefix and land the file at the wrong destination.
    expect(lines[firstRename]).toContain('backend/test/unit/demo_mod/moves-in.test.ts==>');
  });
});

describe('the script itself', () => {
  it('holds no enumerated root list, which refusal 14 refuses outright', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const body = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(body).not.toContain('HISTORICAL_ROOTS');
    expect(body).not.toContain('admin/src/modules/');
    expect(body).toContain('derive-extraction-path-set.ts');
    expect(body).toContain('--paths-from-file');
  });
});
