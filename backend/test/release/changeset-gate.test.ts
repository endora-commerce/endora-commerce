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
 * `node:22.17-slim`, which ships no git, and `test/helpers/shell-check-fixture.ts`
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
 *      discriminator is the diff (files deleted under `.changeset/`, none
 *      added), never a branch name, and on such a branch the job asks the
 *      inverted question instead: did anything's `version` move.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const CHANGESET_BIN = join(REPO_ROOT, 'node_modules/.bin/changeset');

const LIBRARIES = [
  'contracts',
  'api-client',
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
    write(
      `packages/${name}/package.json`,
      readFileSync(join(REPO_ROOT, 'packages', name, 'package.json'), 'utf8'),
    );
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
   * the *same* branch that fails above passes with `privatePackages.version` at
   * the config default, and the output is a cheerful "Packages to be bumped:"
   * with nothing under it.
   */
  it('passes that same branch when `privatePackages.version` is `false`', () => {
    const dir = fixture({
      mutateConfig: (config) => {
        config['privatePackages'] = { version: false, tag: false };
      },
    });
    const run = branchWith((root) => {
      writeFileSync(join(root, 'packages/contracts/src/index.ts'), 'export const marker = 2;\n');
    }, dir);

    expect(run.status).toBe(0);
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
   * The discriminator itself: the two `git diff --diff-filter` invocations
   * `release:changeset` runs, over the branch shapes it has to tell apart. A
   * branch name would have been the easy answer and is not a fact about the
   * diff; consuming changeset files is.
   */
  const consumed = (dir: string, filter: 'D' | 'A'): readonly string[] =>
    git(
      dir,
      'diff',
      // Without this, git folds "a changeset consumed and another written" into
      // one rename — two changeset files differing by a single word are well
      // over the similarity threshold — and the classification becomes a
      // function of how alike two summaries happen to read. Measured: the
      // consume-and-write case below reported no delete and no add.
      '--no-renames',
      `--diff-filter=${filter}`,
      '--name-only',
      'master...HEAD',
      '--',
      '.changeset',
    )
      .split('\n')
      .filter((line) => line.endsWith('.md') && !line.toLowerCase().endsWith('readme.md'));

  it('classifies a release branch as one that deletes changesets and adds none', () => {
    const dir = releaseBranch();

    expect(consumed(dir, 'D')).toEqual(['.changeset/a.md']);
    expect(consumed(dir, 'A')).toEqual([]);
  });

  it('does not classify an ordinary branch that adds one as a release', () => {
    const dir = fixture();
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'topic');
    writeFileSync(join(dir, '.changeset/a.md'), changeset('@endora-commerce/contracts', 'minor'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'topic');

    expect(consumed(dir, 'D')).toEqual([]);
    expect(consumed(dir, 'A')).toEqual(['.changeset/a.md']);
  });

  /**
   * And the branch that both consumes and writes — a release rebased onto new
   * intent. It is **not** a release branch to the discriminator, so it goes to
   * `changeset status`, which is right: it carries a changeset, so the ordinary
   * question has an ordinary answer.
   */
  it('does not classify a branch that consumes and writes as a release', () => {
    const dir = fixture({ files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') } });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'topic');
    runChangeset(dir, ['version']);
    writeFileSync(join(dir, '.changeset/b.md'), changeset('@endora-commerce/contracts', 'patch'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'topic');

    expect(consumed(dir, 'D')).toEqual(['.changeset/a.md']);
    expect(consumed(dir, 'A')).toEqual(['.changeset/b.md']);
    expect(runChangeset(dir, ['status', '--since=master']).status).toBe(0);
  });

  /**
   * The inverted question the job asks on a release branch: did it release
   * anything. A `changeset version` that moved nothing produces a branch with
   * consumed changesets and no `"version"` line in the diff — which is the
   * `privatePackages.version: false` no-op arriving through the other door.
   */
  it('shows a moved `version` line on a real release and none on a vacuous one', () => {
    const real = releaseBranch();
    expect(git(real, 'diff', '-U0', 'master...HEAD', '--', '*/package.json')).toMatch(
      /^\+\s*"version"\s*:/m,
    );

    const vacuous = fixture({
      mutateConfig: (config) => {
        config['privatePackages'] = { version: false, tag: false };
      },
      files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') },
    });
    initialCommit(vacuous);
    git(vacuous, 'checkout', '-q', '-b', 'release/version');
    runChangeset(vacuous, ['version']);
    // Nothing moved, so there is nothing to commit but the deletion a human
    // would have made while "cleaning up".
    rmSync(join(vacuous, '.changeset/a.md'));
    git(vacuous, 'add', '-A');
    git(vacuous, 'commit', '-q', '-m', 'chore: version packages');

    expect(consumed(vacuous, 'D')).toEqual(['.changeset/a.md']);
    expect(git(vacuous, 'diff', '-U0', 'master...HEAD', '--', '*/package.json')).not.toMatch(
      /^\+\s*"version"\s*:/m,
    );
  });
});

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

  function branch(mutate: (dir: string) => void): string {
    const dir = fixture({ files: hostPackageFiles() });
    initialCommit(dir);
    git(dir, 'checkout', '-q', '-b', 'topic');
    mutate(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'topic');
    return dir;
  }

  /** The second command of `release:changeset`, run the way the job runs it. */
  function publishedSurfaceGate(dir: string): { status: number; output: string } {
    const result = spawnSync(
      join(REPO_ROOT, 'backend/node_modules/.bin/tsx'),
      [
        join(REPO_ROOT, 'backend/scripts/check-release-intent.ts'),
        '--root',
        dir,
        '--since',
        'master',
      ],
      { cwd: dir, encoding: 'utf8' },
    );
    return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
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

    const run = publishedSurfaceGate(dir);

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

    expect(publishedSurfaceGate(dir).status).toBe(0);
  });

  /**
   * The other direction, and the reason the two commands are complementary
   * rather than redundant: a change inside a package's own directory is the
   * CLI's question, and the second gate says nothing about it.
   */
  it('says nothing about a change `changeset status` already refuses', () => {
    const dir = branch((root) => {
      writeFileSync(join(root, 'packages/contracts/src/index.ts'), 'export const marker = 2;\n');
    });

    expect(runChangeset(dir, ['status', '--since=master']).status).toBe(1);
    expect(publishedSurfaceGate(dir).status).toBe(0);
  });

  /** An application file no package compiles stays an application file. */
  it('says nothing about an application change outside every published surface', () => {
    const dir = branch((root) => {
      writeFileSync(join(root, 'backend/src/index.ts'), 'export const marker = 2;\n');
    });

    expect(runChangeset(dir, ['status', '--since=master']).status).toBe(0);
    expect(publishedSurfaceGate(dir).status).toBe(0);
  });

  /** `release:changeset` names the command, or the edge is closed by nothing. */
  it('is named by the `release:changeset` job', () => {
    const ci = readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');
    expect(ci).toContain('run check:release-intent -- --since "origin/$base"');
  });
});
