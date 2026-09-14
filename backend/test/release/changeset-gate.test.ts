import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The merge-request gate itself, over real git branches (feature 080, T043).
 *
 * ## Why this is not under `test/unit/`
 *
 * It needs **git**, and the backend unit suite deliberately has none: it runs in
 * `node:22.18-slim`, which ships no git, and `test/helpers/shell-check-fixture.ts`
 * fakes `git ls-files` for exactly that reason. Faking it here would defeat the
 * file — the discriminator under test *is* a `git diff`, and a fake would prove
 * the fake. So this file sits outside every suite's default include and is run
 * by the job it is about:
 *
 *   pnpm --filter backend run test:release-gate      # locally
 *   release:changeset                                # in CI, which installs git
 *
 * That job already installs git, already runs on every merge request, and is
 * the one whose behaviour this measures. Nothing here reaches Postgres, Redis
 * or Meilisearch, and nothing imports a `@endora-commerce/*` package, so it needs neither
 * service containers nor `build:packages` — which is why the job can keep both
 * omissions.
 *
 * ## What it measures
 *
 * Two things, and the second had no proof of any kind:
 *
 *   1. **The gate still does what D-107 says**, after the five packages gained
 *      `build` scripts, `files`, `exports` and two tsconfigs each in T042 — and
 *      **stops** doing it when `privatePackages.version` is the config default,
 *      which is the same branch passing instead of failing.
 *   2. **A release branch is the one branch the gate would refuse for doing its
 *      job.** `pnpm run version:packages` consumes the pending changesets, so
 *      its merge request changes every bumped manifest and carries zero
 *      changesets — precisely the shape the gate exists to fail. The
 *      discriminator is the diff, never a branch name, and on such a branch the
 *      job asks a different question: did this branch release anything.
 *
 * ## What changed with feature 114, and what this file stopped doing
 *
 * The discriminator used to be *"changeset files deleted and none added"* —
 * a **tool's signature**, `changeset version`'s — and it lived in twelve lines
 * of `.gitlab-ci.yml`. This file re-implemented those two `git diff`
 * invocations and asserted about **its own copy**, which made it the only judge
 * the shell ever had and made the pair two derivations of one predicate.
 *
 * D-212 classifies a branch by what it **produced**: a moved `version` in a
 * versionable package's manifest, an added `## <version>` CHANGELOG section, or
 * both. That decision moved into `check-release-intent`, where contract §8's
 * eight red proofs drive it on synthetic input at the top of the analysis —
 * something a shell cannot take (issue #130). So the re-implementation is gone
 * and what is left here is the half a fixture cannot prove: the same branch
 * shapes over **real git**, judged by the one implementation, including the two
 * D-210 performs (the hand-set release and the history landing) and the empty
 * changeset that used to open the gate for both.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const CHANGESET_BIN = join(REPO_ROOT, 'node_modules/.bin/changeset');

// The library packages this file stands a fixture workspace up from. It is a
// list rather than a derivation because the fixture is a *reduced* workspace —
// five manifests and two applications, not 78 packages — and the reduction is
// what keeps `changeset status` measurable here. `api-client` was among them
// until D-202 deleted the package; the entry outlived it, and every test in
// this file failed on `ENOENT` for a manifest that is not there. Nothing saw
// it: this file runs under `vitest.release.config.ts`, which `test:unit:fast`
// does not read, so the only instrument was the `release:changeset` job.
const LIBRARIES = [
  'contracts',
  'page-builder-core',
  'cms-components',
  'email-components',
] as const;
const APPLICATIONS = ['backend', 'admin', 'storefront', 'docs'] as const;

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

interface FixtureOptions {
  /** Applied to a copy of the real `.changeset/config.json`. */
  readonly mutateConfig?: (config: Record<string, unknown>) => void;
  /**
   * Libraries to mark `"private": true` in the fixture.
   *
   * `privatePackages.version` governs **private** packages, so the two
   * measurements below that need one are only available over a private
   * package — and since the owner's publication ruling of 2026-09-05 there is
   * none left in this repository to borrow. The precondition therefore belongs
   * in the fixture rather than in the tree, which is also the more honest place
   * for it: those tests measure what changesets does to a private package, and
   * a fixture that got that state by accident of the day it ran is a test
   * measuring the calendar. `changeset-flow.test.ts` took this shape in the
   * publication branch itself; this file was not repaired with it, because
   * nothing on a merge request runs it.
   */
  readonly privateLibraries?: readonly string[];
  /** Extra files, repository-relative. */
  readonly files?: Readonly<Record<string, string>>;
}

/** A checkout of this repository's manifests and changeset config, in a temporary directory. */
function fixture(options: FixtureOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'changeset-gate-'));
  workspace = dir;

  const write = (relative: string, content: string): void => {
    mkdirSync(dirname(join(dir, relative)), { recursive: true });
    writeFileSync(join(dir, relative), content);
  };

  write('pnpm-workspace.yaml', readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8'));
  write('package.json', '{ "name": "b2b-platform", "version": "0.0.0", "private": true }');
  for (const name of LIBRARIES) {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages', name, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    if (options.privateLibraries?.includes(name) === true) manifest['private'] = true;
    write(`packages/${name}/package.json`, JSON.stringify(manifest, null, 2));
    // The real emit configuration, because `--since` derives what a package
    // publishes from it. Copied rather than invented: the property under test
    // is that these five publish only their own directories today, which is
    // what makes the host package's arrival the change D-162 exists for.
    for (const config of ['tsconfig.json', 'tsconfig.build.json']) {
      write(
        `packages/${name}/${config}`,
        readFileSync(join(REPO_ROOT, 'packages', name, config), 'utf8'),
      );
    }
    write(`packages/${name}/src/index.ts`, 'export const marker = 1;\n');
  }
  for (const name of APPLICATIONS) {
    write(`${name}/package.json`, readFileSync(join(REPO_ROOT, name, 'package.json'), 'utf8'));
    write(`${name}/src/index.ts`, 'export const marker = 1;\n');
  }

  const config = JSON.parse(
    readFileSync(join(REPO_ROOT, '.changeset/config.json'), 'utf8'),
  ) as Record<string, unknown>;
  options.mutateConfig?.(config);
  write('.changeset/config.json', JSON.stringify(config, null, 2));

  for (const [relative, content] of Object.entries(options.files ?? {})) write(relative, content);
  return dir;
}

const changeset = (name: string, bump: string): string =>
  `---\n"${name}": ${bump}\n---\n\na change worth releasing\n`;

function runChangeset(dir: string, args: readonly string[]): { status: number; output: string } {
  const result = spawnSync(CHANGESET_BIN, [...args], { cwd: dir, encoding: 'utf8' });
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

function initialCommit(dir: string): void {
  git(dir, 'init', '-q', '-b', 'master');
  git(dir, 'config', 'user.email', 'release@example.com');
  git(dir, 'config', 'user.name', 'Release Fixture');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
}

describe('the tools this file measures are the real ones', () => {
  it('has git, which is why the file is not in the unit suite', () => {
    expect(execFileSync('git', ['--version'], { encoding: 'utf8' })).toContain('git version');
  });
});

describe('`changeset status --since` — the merge-request gate', () => {
  function branchWith(
    mutate: (dir: string) => void,
    dir: string,
  ): { status: number; output: string } {
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'topic');
    mutate(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'topic');
    return runChangeset(dir, ['status', '--since=master']);
  }

  it('fails a branch that changes `packages/` and carries no changeset', () => {
    const dir = fixture();
    const run = branchWith((root) => {
      writeFileSync(join(root, 'packages/contracts/src/index.ts'), 'export const marker = 2;\n');
    }, dir);

    expect(run.status).toBe(1);
    expect(run.output).toContain('no changesets were found');
  });

  it('passes the same branch once it carries one', () => {
    const dir = fixture();
    const run = branchWith((root) => {
      writeFileSync(join(root, 'packages/contracts/src/index.ts'), 'export const marker = 2;\n');
      writeFileSync(join(root, '.changeset/a.md'), changeset('@endora-commerce/contracts', 'minor'));
    }, dir);

    expect(run.status).toBe(0);
  });

  /** The `ignore` list, exercised end to end: an application needs nothing. */
  it('passes a branch that changes only an ignored application', () => {
    const dir = fixture();
    const run = branchWith((root) => {
      writeFileSync(join(root, 'backend/src/index.ts'), 'export const marker = 2;\n');
    }, dir);

    expect(run.status).toBe(0);
  });

  /**
   * The failure `check-release-intent` exists for, seen through the gate itself:
   * a branch that changes a **private** versionable package passes with
   * `privatePackages.version` at the config default, and the output is a
   * cheerful "Packages to be bumped:" with nothing under it.
   *
   * It used to edit `packages/contracts` and is now `email-components` made
   * private **by the fixture**: feature 104 published every package in the
   * tree, and `privatePackages` governs private packages only — which is the
   * discrimination below, and the reason this pair is worth two tests rather
   * than one. Borrowing the state from whichever package happened to be
   * private was what made this case go stale; declaring it here is what stops
   * it going stale again.
   */
  it('passes a branch changing a private package when `privatePackages.version` is `false`', () => {
    const dir = fixture({
      privateLibraries: ['email-components'],
      mutateConfig: (config) => {
        config['privatePackages'] = { version: false, tag: false };
      },
    });
    const run = branchWith((root) => {
      writeFileSync(
        join(root, 'packages/email-components/src/index.ts'),
        'export const marker = 2;\n',
      );
    }, dir);

    expect(run.status).toBe(0);
  });

  /**
   * …and the half that is only true since three packages became public: the
   * same configuration silences nothing for a package that is not private.
   * `privatePackages.version` is `getVersionableChangedPackages`' switch for
   * *private* members alone, so the gate keeps asking for the ones a consumer
   * can actually install — which is what makes `version-disabled` a rule about
   * the private remainder rather than about the repository.
   */
  it('still fails that branch when the package is public', () => {
    const dir = fixture({
      mutateConfig: (config) => {
        config['privatePackages'] = { version: false, tag: false };
      },
    });
    const run = branchWith((root) => {
      writeFileSync(join(root, 'packages/contracts/src/index.ts'), 'export const marker = 2;\n');
    }, dir);

    expect(run.status).toBe(1);
    expect(run.output).toContain('no changesets were found');
  });
});

describe('a release branch is the one branch the gate would refuse for doing its job', () => {
  /**
   * The premise of the discriminator in `release:changeset`, measured: the
   * branch `pnpm run version:packages` produces changes every bumped manifest
   * and carries zero changesets, which is exactly the shape the gate exists to
   * fail.
   */
  function releaseBranch(): string {
    const dir = fixture({ files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') } });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'release/version');
    runChangeset(dir, ['version']);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: version packages');
    return dir;
  }

  it('is refused by `changeset status`, which is why the job asks a different question', () => {
    const dir = releaseBranch();

    const run = runChangeset(dir, ['status', '--since=master']);

    expect(run.status).toBe(1);
    expect(run.output).toContain('no changesets were found');
  });

  /**
   * The classification itself, over real branches, through the check that owns
   * it (feature 114, D-212).
   *
   * **This block used to re-implement the gate.** It ran the same two
   * `git diff --diff-filter` invocations `release:changeset` carried in shell
   * and asserted about its own copy — two derivations of one predicate, and the
   * only judge the shell's twelve lines ever had. Contract §5 is why they are
   * gone: a shell cannot take a fixture at the top of its analysis (issue #130),
   * so the classification moved into `check-release-intent`, where the eight red
   * proofs of contract §8 drive it on synthetic input. What is left here is the
   * half a fixture cannot prove — the same shapes over **real git**, judged by
   * the one implementation.
   */
  it('passes a release branch, and says which shape it measured', () => {
    const run = releaseGate(releaseBranch());

    expect(run.status).toBe(0);
    expect(run.output).toContain('shape=release');
    expect(run.output).toContain('violations=0');
  });

  it('passes an ordinary branch that adds a changeset', () => {
    const dir = fixture();
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'topic');
    writeFileSync(join(dir, 'packages/contracts/src/index.ts'), 'export const marker = 2;\n');
    writeFileSync(join(dir, '.changeset/a.md'), changeset('@endora-commerce/contracts', 'minor'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'topic');

    const run = releaseGate(dir);

    expect(run.status).toBe(0);
    expect(run.output).toContain('shape=ordinary');
  });

  /**
   * Contract §9 — the one assertion in this file that encoded the superseded
   * rule, rewritten to the classification that replaces it rather than kept
   * beside it.
   *
   * It read *"does not classify a branch that consumes and writes as a
   * release"*, which was a statement about the **tool's signature**: the branch
   * both deleted and added changeset files, so the shell's
   * deleted-and-none-added test did not match it and it fell through to
   * `changeset status`. Under D-212 the same branch is classified by what it
   * **produced** — a release rebased onto new intent has produced the artefacts,
   * so it is a release. The verdict is unchanged, and the route to it is not:
   * this passed then and it passes now.
   */
  it('classifies a release rebased onto new intent by its artefacts, not by what it consumed', () => {
    const dir = fixture({
      files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') },
    });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'topic');
    runChangeset(dir, ['version']);
    writeFileSync(join(dir, '.changeset/b.md'), changeset('@endora-commerce/contracts', 'patch'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'topic');

    const run = releaseGate(dir);

    expect(run.status).toBe(0);
    expect(run.output).toContain('shape=release');
  });

  /**
   * The refusal, and the shape it is aimed at: a `changeset version` that moved
   * nothing, followed by a human deleting the files while tidying up. Measured
   * in `research.md` §4 — under `privatePackages.version: false` the no-op
   * writes no version, writes no changelog and does not even delete the
   * changeset files, which is why widening the artefact to a changelog section
   * cannot reach it.
   */
  function vacuousRelease(): string {
    const dir = fixture({
      privateLibraries: ['email-components'],
      mutateConfig: (config) => {
        config['privatePackages'] = { version: false, tag: false };
      },
      files: { '.changeset/a.md': changeset('@endora-commerce/email-components', 'minor') },
    });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'release/version');
    runChangeset(dir, ['version']);
    rmSync(join(dir, '.changeset/a.md'));
    return dir;
  }

  it('refuses a branch that consumed the changesets and released nothing', () => {
    const dir = vacuousRelease();
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: version packages');

    const run = releaseGate(dir);

    expect(run.status).toBe(1);
    expect(run.output).toContain('vacuous-release');
    expect(run.output).toContain('shape=vacuous');
  });

  /**
   * The lockpick, over real git (A4). Measured under the superseded rule: one
   * empty changeset took the *same* branch to exit 0 — and for the history
   * landing it removed the branch from the release class entirely, so nothing
   * anywhere asked whether it had released anything. An empty changeset is a
   * human's "I looked, there is nothing to release", never a declaration that a
   * release happened.
   */
  it('is not opened by an empty changeset', () => {
    const dir = vacuousRelease();
    writeFileSync(join(dir, '.changeset/empty.md'), '---\n---\n\nnothing to release\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: version packages');

    const run = releaseGate(dir);

    expect(run.status).toBe(1);
    expect(run.output).toContain('vacuous-release');
  });

  /** The manifest a branch edits by hand, with `mutate` applied to it. */
  function editManifest(
    dir: string,
    relative: string,
    mutate: (manifest: Record<string, unknown>) => void,
  ): void {
    const manifest = JSON.parse(readFileSync(join(dir, relative), 'utf8')) as Record<
      string,
      unknown
    >;
    mutate(manifest);
    writeFileSync(join(dir, relative), JSON.stringify(manifest, null, 2));
  }

  /**
   * D-210's first act, over real git (A1): every versionable package's `version`
   * moves in one commit, no changeset is consumed, no changelog is written.
   * `changeset status` refuses it — it attributes any changed file under
   * `packages/<p>/` to that package, including the one file whose change **is**
   * the release — and the measurement above this describe is that refusal.
   */
  it('passes the hand-set release, which `changeset status` refuses', () => {
    const dir = fixture();
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'release-by-hand');
    for (const name of LIBRARIES) {
      editManifest(dir, `packages/${name}/package.json`, (manifest) => {
        // A version the tree is not already at — the manifests are copied from
        // this repository, so writing today's number commits nothing and the
        // case would measure an empty branch.
        manifest['version'] = '9.9.9';
      });
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: set the first version');

    expect(runChangeset(dir, ['status', '--since=master']).status).toBe(1);

    const run = releaseGate(dir);

    expect(run.status).toBe(0);
    expect(run.output).toContain('shape=release');
    expect(run.output).toContain(`versions-moved=${String(LIBRARIES.length)}`);
  });

  /**
   * D-210's second act, over real git (A2): the pending changesets become the
   * released version's history. Every changeset file goes, one `## <version>`
   * section is written per released package, and **no version moves** — which is
   * precisely the shape the superseded inverted question refused, that question
   * having been aimed at a `changeset version` that silently did nothing.
   */
  it('passes the history landing, which consumes everything and moves no version', () => {
    const dir = fixture({
      files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') },
    });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'land-the-history');
    rmSync(join(dir, '.changeset/a.md'));
    writeFileSync(
      join(dir, 'packages/contracts/CHANGELOG.md'),
      '# @endora-commerce/contracts\n\n## 0.7.0\n\n- a change worth releasing\n',
    );
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: land the accumulated changesets at 0.7.0');

    const run = releaseGate(dir);

    expect(run.status).toBe(0);
    expect(run.output).toContain('shape=release');
    expect(run.output).toContain('changelog-sections=1');
    expect(run.output).toContain('versions-moved=0');
  });

  /**
   * A5 — the half nothing else in this repository can see. The `version` field
   * is release-neutral and every other key of a manifest is consumer-facing:
   * `exports` compiles into nothing, so neither `changeset status` nor the
   * published-surface pass can see it narrow, and a file-level exemption would
   * wave the whole manifest through.
   */
  it('refuses a branch that moves a version and narrows an `exports` map', () => {
    const dir = fixture();
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'release-and-narrow');
    editManifest(dir, 'packages/contracts/package.json', (manifest) => {
      manifest['version'] = '9.9.9';
      // The real manifest publishes `.` and `./*`; this keeps the first and
      // drops the second, which is a subpath a consumer resolves today and
      // would stop resolving — invisible to `changeset status`, which sees a
      // changed file under the package's own directory and attributes it to the
      // release this branch claims to be.
      manifest['exports'] = { '.': { types: './dist/index.d.ts', default: './dist/index.js' } };
    });
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: set the first version');

    const run = releaseGate(dir);

    expect(run.status).toBe(1);
    expect(run.output).toContain('manifest-changed-beyond-version');
    expect(run.output).toContain('@endora-commerce/contracts');
  });
});

/**
 * A file the host package compiles into its `dist` from outside its own
 * directory. Shared by the D-162 describe and the baseline describe below,
 * because both need a branch the published-surface gate has something to say
 * about.
 */
const HOST_SOURCE = 'backend/src/kernel/settings/settings-cache.ts';

/** The host package, in the shape !891 gives it. */
const hostPackageFiles = (): Readonly<Record<string, string>> => ({
  'packages/platform/package.json': JSON.stringify(
    { name: '@endora-commerce/platform', version: '0.0.0', private: true, main: './dist/index.js' },
    null,
    2,
  ),
  'packages/platform/tsconfig.json': JSON.stringify(
    {
      include: ['../../backend/src/kernel/**/*'],
      exclude: ['../../backend/src/**/*.test.ts'],
    },
    null,
    2,
  ),
  'packages/platform/tsconfig.build.json': JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: { rootDir: '../../backend/src', noEmit: false, noEmitOnError: true },
    },
    null,
    2,
  ),
  'packages/platform/README.md': 'The host package.\n',
  [HOST_SOURCE]: 'export const marker = 1;\n',
});

/**
 * The gate, run the way `release:changeset` runs it.
 *
 * It was the job's *second* command until feature 114; it is now the only one,
 * and it spawns `changeset status` itself for the branches it classifies as
 * ordinary (FR-006, FR-007). The name says the whole gate because that is what
 * the one invocation is.
 */
function releaseGate(dir: string, since = 'master'): { status: number; output: string } {
  const result = spawnSync(
    join(REPO_ROOT, 'backend/node_modules/.bin/tsx'),
    [join(REPO_ROOT, 'backend/scripts/check-release-intent.ts'), '--root', dir, '--since', since],
    { cwd: dir, encoding: 'utf8' },
  );
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * D-162 — the gate inverted with respect to what it protects, and its closure.
 *
 * `changeset status` decides which package a changed file belongs to by asking
 * which package **directory** it sits under. `@endora-commerce/platform` was
 * that shape when D-162 was ruled (!891): manifest and tsconfigs under
 * `packages/platform`, five directories of `backend/src` compiled into its
 * `dist`, and `backend` in `ignore` — so the CLI reported nothing for a commit
 * editing the code the package publishes and a violation for one editing its
 * README, which ships in nothing.
 *
 * **The platform relocation moved those five directories into the package**, so
 * this repository no longer holds an instance of the shape. The fixture below
 * stages one anyway, and deliberately: D-162 is a statement about how the CLI
 * attributes a file, not about one package, and the next package whose build
 * reaches outside its directory would arrive with the gate inverted and nothing
 * to say so. Reading it as a description of today's `packages/platform` is the
 * one wrong way to read it.
 *
 * Both halves are measured over real branches, because the inversion is a
 * property of a `git diff` against a workspace and a fake would prove the fake.
 * The second command of `release:changeset` is what closes it, and it derives
 * the package's real sources from its own `tsconfig.build.json`.
 */
describe('a package whose sources are not its own directory (D-162)', () => {
  function branch(mutate: (dir: string) => void): string {
    const dir = fixture({ files: hostPackageFiles() });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'topic');
    mutate(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'topic');
    return dir;
  }

  it('is invisible to `changeset status` when its published source changes', () => {
    const dir = branch((root) => {
      writeFileSync(join(root, HOST_SOURCE), 'export const marker = 2;\n');
    });

    const run = runChangeset(dir, ['status', '--since=master']);

    // The measurement, not the aspiration: the CLI passes a branch that changes
    // what the package publishes.
    expect(run.status).toBe(0);
  });

  it('fires `changeset status` for its README, which ships in nothing', () => {
    const dir = branch((root) => {
      writeFileSync(join(root, 'packages/platform/README.md'), 'The host package. Edited.\n');
    });

    expect(runChangeset(dir, ['status', '--since=master']).status).toBe(1);
  });

  it('is refused by the published-surface gate, which is what closes the edge', () => {
    const dir = branch((root) => {
      writeFileSync(join(root, HOST_SOURCE), 'export const marker = 2;\n');
    });

    const run = releaseGate(dir);

    expect(run.status).toBe(1);
    expect(run.output).toContain('unattributed-published-change');
    expect(run.output).toContain('@endora-commerce/platform');
    expect(run.output).toContain(HOST_SOURCE);
  });

  it('passes the same branch once it carries a changeset', () => {
    const dir = branch((root) => {
      writeFileSync(join(root, HOST_SOURCE), 'export const marker = 2;\n');
      writeFileSync(join(root, '.changeset/a.md'), changeset('@endora-commerce/platform', 'patch'));
    });

    expect(releaseGate(dir).status).toBe(0);
  });

  /**
   * The other direction, and the reason the two commands are complementary
   * rather than redundant: a change inside a package's own directory is the
   * CLI's question, and the second gate says nothing about it.
   */
  it('says nothing of its own about a change `changeset status` already refuses', () => {
    const dir = branch((root) => {
      writeFileSync(join(root, 'packages/contracts/src/index.ts'), 'export const marker = 2;\n');
    });

    expect(runChangeset(dir, ['status', '--since=master']).status).toBe(1);

    const run = releaseGate(dir);

    // Refused, and by the CLI's own verdict rather than by a second one: the
    // gate is one invocation since feature 114, so "the published-surface
    // question says nothing about this" is now a statement about which finding
    // comes back, not about the exit code.
    expect(run.status).toBe(1);
    expect(run.output).toContain('unattributed-package-change');
    expect(run.output).not.toContain('unattributed-published-change');
  });

  /** An application file no package compiles stays an application file. */
  it('says nothing about an application change outside every published surface', () => {
    const dir = branch((root) => {
      writeFileSync(join(root, 'backend/src/index.ts'), 'export const marker = 2;\n');
    });

    expect(runChangeset(dir, ['status', '--since=master']).status).toBe(0);
    expect(releaseGate(dir).status).toBe(0);
  });

  /** `release:changeset` names the command, or the edge is closed by nothing. */
  it('is named by the `release:changeset` job', () => {
    const ci = readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');
    expect(ci).toContain('run check:release-intent -- --since "origin/$base"');
  });
});

/**
 * The baseline, and the two ways a diff comes back empty (pipeline 11491).
 *
 * A correct merge request produced a red pipeline. !916 changed three
 * Dockerfiles, a `.dockerignore`, a shell script and a test, and
 * `check:release-intent --since origin/master` exited 2 on *"the branch changes
 * no file at all"*. It did: the merge request had already been **merged** when
 * the job fetched its baseline, so every commit of `HEAD` was already reachable
 * from `origin/master` and there was no delta left to measure. At this project's
 * merge cadence that is not an anomaly, it is a schedule.
 *
 * **The merge base was never the problem, and this is the measurement that says
 * so.** `git diff A...B` is by definition the diff from `merge-base(A, B)` to
 * `B`, which is exactly a merge request's diff, and the check has written the
 * three dots since !882. What the merge base cannot do is survive its own branch
 * being merged: once `HEAD` is an ancestor of the baseline, `merge-base` **is**
 * `HEAD`, so the three-dot diff is `HEAD` against itself. Re-baselining changes
 * nothing here — it is already the baseline — and that is why the repair is a
 * new *fact*, not a new ref: `git merge-base --is-ancestor HEAD <baseline>`.
 *
 * The four cases are the point of this describe, and the exit codes are all
 * different on purpose:
 *
 *   * changes, no changeset      -> **1**, the finding. The gate does its job.
 *   * changes, with a changeset  -> **0**, the ordinary pass.
 *   * commits, but an empty diff -> **2**, unchanged. A branch with a real fork
 *     point that changes no file is not the input this mode was asked about, and
 *     turning that into a pass is the whole thing issue #113 refuses.
 *   * already merged             -> **0**, and it says which fact it is on. The
 *     baseline contains the branch, so the set of files the branch adds to the
 *     baseline is empty **by construction** rather than by a measurement that
 *     came back empty. There is a verdict, and it was measured.
 *
 * Squash-merge is deliberately in here too. It leaves `HEAD` outside the
 * baseline's history, so the branch still proposes its change relative to the
 * merge base and the gate still asks its real question — the containment answer
 * must not swallow it.
 */
describe('the baseline, and the two ways a diff comes back empty', () => {
  /** A branch off `master` with the host package staged, ready to be judged. */
  function topic(name: string, mutate: (dir: string) => void): string {
    const dir = fixture({ files: hostPackageFiles() });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', name);
    mutate(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', name);
    return dir;
  }

  /** Merge the named branch into `master` and check it out again, as a merge request does. */
  function mergeIntoMaster(dir: string, name: string): void {
    git(dir, 'checkout', '-q', 'master');
    git(dir, 'merge', '-q', '--no-ff', '-m', `merge ${name}`, name);
    git(dir, 'checkout', '-q', name);
  }

  const changesAPublishedFile = (root: string): void => {
    writeFileSync(join(root, HOST_SOURCE), 'export const marker = 2;\n');
  };

  it('goes red on a branch that changes a published surface and carries no changeset', () => {
    const run = releaseGate(topic('topic', changesAPublishedFile));

    expect(run.status).toBe(1);
    expect(run.output).toContain('unattributed-published-change');
  });

  it('passes the same branch once it carries a changeset', () => {
    const run = releaseGate(
      topic('topic', (root) => {
        changesAPublishedFile(root);
        writeFileSync(
          join(root, '.changeset/a.md'),
          changeset('@endora-commerce/platform', 'patch'),
        );
      }),
    );

    expect(run.status).toBe(0);
    expect(run.output).toContain('violations=0');
  });

  /**
   * The refusal !882 built, unchanged. A commit that changes no file has a real
   * fork point and a real, distinct baseline — the diff came back empty, it was
   * not empty by construction — so this is still "I did not measure anything".
   */
  it('still refuses a branch whose commits change no file at all', () => {
    const dir = fixture({ files: hostPackageFiles() });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'topic');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'topic');

    const run = releaseGate(dir);

    expect(run.status).toBe(2);
    expect(run.output).toContain('changes no file at all');
    // And it says so in the terms that tell the two apart, so the next reader of
    // a red pipeline does not have to re-derive which one they are looking at.
    expect(run.output).toContain('not already contained in `master`');
  });

  /**
   * The race itself: the *same* branch as the red case above, and the only
   * difference is that `master` has since absorbed it.
   */
  it('reports containment, not an empty diff, once the branch is merged into the baseline', () => {
    const dir = topic('topic', changesAPublishedFile);
    expect(releaseGate(dir).status).toBe(1);

    mergeIntoMaster(dir, 'topic');
    const run = releaseGate(dir);

    expect(run.status).toBe(0);
    expect(run.output).toContain('already contained in `master`');
    expect(run.output).toContain('contained=yes');
    // The refusal it replaces must not be what a reader sees.
    expect(run.output).not.toContain('changes no file at all');
  });

  /**
   * A squash merge puts the *content* in the baseline and leaves the commit
   * outside its history, so the branch still proposes a change and the gate
   * still has its ordinary question to ask. Containment is ancestry, not
   * similarity, and this is the case that would break if it were widened to
   * "the diff is empty for some git-shaped reason".
   */
  it('says nothing about a squash-merged branch, which is still outside the baseline', () => {
    const dir = topic('topic', changesAPublishedFile);
    git(dir, 'checkout', '-q', 'master');
    git(dir, 'merge', '-q', '--squash', 'topic');
    git(dir, 'commit', '-q', '-m', 'squashed topic');
    git(dir, 'checkout', '-q', 'topic');

    const run = releaseGate(dir);

    expect(run.status).toBe(1);
    expect(run.output).toContain('unattributed-published-change');
  });

  /**
   * The two-way property !882 built, over the new answer: the verdict is read
   * off the diff and the commit graph, never off a branch name. A branch called
   * `release/version` that is *not* merged is judged like any other, and a
   * branch called `feature/...` that *is* merged is contained.
   */
  it('reads containment off the commit graph, never off the branch name', () => {
    const unmerged = topic('release/version', changesAPublishedFile);
    expect(releaseGate(unmerged).status).toBe(1);

    const merged = topic('feature/still-in-flight', changesAPublishedFile);
    mergeIntoMaster(merged, 'feature/still-in-flight');
    expect(releaseGate(merged).status).toBe(0);
    expect(releaseGate(merged).output).toContain('already contained');
  });

  /**
   * And the release branch itself, merged. Containment is answered before
   * anything is read, so it reaches the branch the classification would
   * otherwise have the most to say about — and it answers it the same way as any
   * other merged branch: there is no delta left to judge, and that is a verdict
   * rather than an empty measurement.
   *
   * The unmerged half of the pair is the premise: the same branch, before the
   * merge, is classified a release on its own artefacts.
   */
  it('reports containment for a merged release branch, ahead of any classification', () => {
    const dir = fixture({
      files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') },
    });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'release/version');
    runChangeset(dir, ['version']);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: version packages');

    expect(releaseGate(dir).output).toContain('shape=release');

    git(dir, 'checkout', '-q', 'master');
    git(dir, 'merge', '-q', '--no-ff', '-m', 'merge release', 'release/version');
    git(dir, 'checkout', '-q', 'release/version');

    const run = releaseGate(dir);

    expect(run.status).toBe(0);
    expect(run.output).toContain('contained=yes');
    expect(run.output).not.toContain('shape=');
  });
});
