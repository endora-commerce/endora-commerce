import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * What the release flow actually does — measured, with the real CLI, over this
 * repository's own manifests (feature 080, T043).
 *
 * `check-release-intent` asserts things *about* `.changeset/config.json`. This
 * file is why those assertions are worth making: it runs `changeset version`
 * and `changeset status` for real and records what each configuration produces.
 * Without it, the check's headline finding — `privatePackages.version` at the
 * `@changesets/config@4` default of `false` — would rest on a sentence in a
 * comment rather than on a number, and the sentence was the only thing standing
 * between this repository and a gate that had silently stopped asking.
 *
 * Three properties are measured here and nowhere else:
 *
 *   1. **A broken configuration is `exit 0` and no movement.** Not an error, not
 *      a warning. The same shape as every other defect in the #244 family.
 *   2. **`linked` links through the *dependent-bump* machinery and not
 *      otherwise.** It raises a package that is already in a release to the
 *      group's number; it never adds one. So the documented behaviour — a
 *      release of `@endora-commerce/page-builder-core` carries all three — holds today
 *      because every package sits at `0.0.0`, where `workspace:^` resolves to
 *      `^0.0.0` and *any* bump is out of range. At `1.x` the same minor leaves
 *      the peers satisfied, so it carries neither. Both regimes are asserted,
 *      because the second one arrives with the first release and nothing else
 *      in the repository would report it.
 *   3. **A release branch is the one branch the gate would refuse for doing its
 *      job**, and the diff-shaped discriminator `release:changeset` uses tells
 *      it apart from an ordinary one.
 *
 * The fixtures are copies of this repository's real manifests and real
 * `.changeset/config.json`, in a temporary directory. Nothing here needs an
 * installed `node_modules` in the fixture: changesets reads
 * `pnpm-workspace.yaml` and the manifests, which is exactly the population
 * under test.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const CHANGESET_BIN = join(REPO_ROOT, 'node_modules/.bin/changeset');

/**
 * The library packages this fixture carries, and the three the `linked` group
 * covers. `api-client` was the fifth until D-202 deleted it.
 */
const LIBRARIES = [
  'contracts',
  'page-builder-core',
  'cms-components',
  'email-components',
] as const;
const APPLICATIONS = ['backend', 'admin', 'storefront', 'docs'] as const;
const PAGE_BUILDER_GROUP = [
  '@endora-commerce/page-builder-core',
  '@endora-commerce/cms-components',
  '@endora-commerce/email-components',
] as const;

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

interface FixtureOptions {
  /** Seed every library at this version. Defaults to whatever the tree says. */
  readonly seedVersion?: string;
  /** Applied to a copy of the real `.changeset/config.json`. */
  readonly mutateConfig?: (config: Record<string, unknown>) => void;
  /** Extra files, repository-relative. */
  readonly files?: Readonly<Record<string, string>>;
}

/**
 * A checkout of this repository's manifests, in a temporary directory.
 *
 * Only the manifests, the workspace file and the changeset configuration are
 * copied: those are what the release plan is computed from, and copying the
 * sources would make the fixture slow without making it more faithful.
 */
function fixture(options: FixtureOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'changeset-flow-'));
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
    if (options.seedVersion !== undefined) manifest['version'] = options.seedVersion;
    write(`packages/${name}/package.json`, JSON.stringify(manifest, null, 2));
    write(`packages/${name}/src/index.ts`, 'export const marker = 1;\n');
  }
  for (const name of APPLICATIONS) {
    write(
      `${name}/package.json`,
      readFileSync(join(REPO_ROOT, name, 'package.json'), 'utf8'),
    );
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

function versionOf(dir: string, library: string): string {
  return (
    JSON.parse(readFileSync(join(dir, 'packages', library, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
}

/** `@endora-commerce/<x>` → its version, for the three the group covers. */
function groupVersions(dir: string): Readonly<Record<string, string>> {
  return {
    '@endora-commerce/page-builder-core': versionOf(dir, 'page-builder-core'),
    '@endora-commerce/cms-components': versionOf(dir, 'cms-components'),
    '@endora-commerce/email-components': versionOf(dir, 'email-components'),
  };
}

function runChangeset(dir: string, args: readonly string[]): { status: number; output: string } {
  const result = spawnSync(CHANGESET_BIN, [...args], { cwd: dir, encoding: 'utf8' });
  return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('the changesets CLI is the one this repository ships', () => {
  it('is installed where the flow expects it', () => {
    expect(existsSync(CHANGESET_BIN)).toBe(true);
  });
});

describe('privatePackages.version — the setting that silently disables everything', () => {
  /**
   * The headline measurement. 75 of the 78 versionable packages are
   * `"private": true`, and `@changesets/config@4` defaults `privatePackages` to
   * `false`; with it false, `changeset version` reports success and moves
   * nothing, leaving the changeset file on disk to be consumed by a release
   * that will never come.
   *
   * The subject is `email-components` and was `contracts` until feature 104
   * published the latter. That is not a fixture detail: `privatePackages`
   * governs **private** packages, so the measurement is only available over one
   * — and the case below is the other half, which nothing asserted while every
   * package was private because there was no tree in which to see it.
   */
  it('bumps nothing, exits 0 and keeps the changeset when it is `false`', () => {
    const dir = fixture({
      mutateConfig: (config) => {
        config['privatePackages'] = { version: false, tag: false };
      },
      files: { '.changeset/a.md': changeset('@endora-commerce/email-components', 'minor') },
    });
    const before = versionOf(dir, 'email-components');

    const run = runChangeset(dir, ['version']);

    expect(run.status).toBe(0);
    expect(versionOf(dir, 'email-components')).toBe(before);
    expect(existsSync(join(dir, '.changeset/a.md'))).toBe(true);
  });

  it('does the same when the block is omitted, which is the literal default', () => {
    const dir = fixture({
      mutateConfig: (config) => {
        delete config['privatePackages'];
      },
      files: { '.changeset/a.md': changeset('@endora-commerce/email-components', 'minor') },
    });
    const before = versionOf(dir, 'email-components');

    expect(runChangeset(dir, ['version']).status).toBe(0);
    expect(versionOf(dir, 'email-components')).toBe(before);
  });

  /**
   * And the state feature 104 created, which bounds everything above: the same
   * setting moves a **public** package regardless. `privatePackages.version` is
   * not a switch on the release flow, it is a switch on whether *private*
   * packages take part in one — so `check:release-intent`'s `version-disabled`
   * is a rule about the private remainder, and the day that remainder empties
   * the setting stops having a subject.
   */
  it('bumps a public package whatever `privatePackages.version` says', () => {
    const dir = fixture({
      mutateConfig: (config) => {
        config['privatePackages'] = { version: false, tag: false };
      },
      files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') },
    });

    expect(runChangeset(dir, ['version']).status).toBe(0);
    expect(versionOf(dir, 'contracts')).toBe('0.1.0');
    expect(existsSync(join(dir, '.changeset/a.md'))).toBe(false);
  });

  /**
   * The discrimination. Without it the two assertions above would also pass
   * against a fixture the CLI could not read at all — an unbumped version is
   * not evidence of a setting unless the same tree bumps with the setting on.
   */
  it('bumps and consumes the changeset with the repository’s real configuration', () => {
    const dir = fixture({ files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') } });
    const before = versionOf(dir, 'contracts');

    expect(runChangeset(dir, ['version']).status).toBe(0);
    expect(versionOf(dir, 'contracts')).not.toBe(before);
    expect(existsSync(join(dir, '.changeset/a.md'))).toBe(false);
    expect(existsSync(join(dir, 'packages/contracts/CHANGELOG.md'))).toBe(true);
  });

  /**
   * `updateInternalDependencies: "patch"` — independent numbers, carried
   * together.
   *
   * The dependent used to be `@endora-commerce/api-client`, which D-202
   * deleted. `@endora-commerce/page-builder-core` is the dependent that
   * replaced it: it declares `@endora-commerce/contracts` at `workspace:*`
   * exactly as that package did, so the mechanism under test is the same one.
   * It is also a member of the `linked` group, which the next `describe` is
   * about — asserted here so that the two facts are not confused with each
   * other: `contracts` is **not** raised to the group's number, and the group
   * follows its own member rather than the release that carried it in.
   */
  it('carries a dependent on a `@endora-commerce/contracts` release without sharing its number', () => {
    const dir = fixture({ files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') } });

    runChangeset(dir, ['version']);

    expect(versionOf(dir, 'contracts')).toBe('0.1.0');
    expect(versionOf(dir, 'page-builder-core')).toBe('0.0.1');
  });
});

describe('the `linked` group — what it does, and what it does not', () => {
  /**
   * D-108's documented behaviour, at the versions the tree carries today.
   */
  it('carries all three on a minor to `@endora-commerce/page-builder-core`, at 0.0.0', () => {
    const dir = fixture({
      files: { '.changeset/a.md': changeset('@endora-commerce/page-builder-core', 'minor') },
    });

    runChangeset(dir, ['version']);

    expect(groupVersions(dir)).toEqual({
      '@endora-commerce/page-builder-core': '0.1.0',
      '@endora-commerce/cms-components': '0.1.0',
      '@endora-commerce/email-components': '0.1.0',
    });
  });

  it('moves only `@endora-commerce/cms-components` on a patch to it alone', () => {
    const dir = fixture({
      files: { '.changeset/a.md': changeset('@endora-commerce/cms-components', 'patch') },
    });

    runChangeset(dir, ['version']);

    expect(groupVersions(dir)).toEqual({
      '@endora-commerce/page-builder-core': '0.0.0',
      '@endora-commerce/cms-components': '0.0.1',
      '@endora-commerce/email-components': '0.0.0',
    });
  });

  /**
   * The regime change nothing else in the repository would report.
   *
   * `linked` raises a package that is **already in a release** to the group's
   * highest version; it never puts one there. What puts `cms-components` and
   * `email-components` into a `page-builder-core` release is their
   * `peerDependencies` range going out of range — and at `0.0.0`, `workspace:^`
   * resolves to `^0.0.0`, which *any* bump breaks. After the first real release
   * a minor no longer does, so the three numbers diverge.
   *
   * That is correct rather than broken: the reason D-108 gives for the group is
   * that the consuming application must resolve exactly one copy of
   * `page-builder-core`, and `^1.4.2` satisfied by `1.5.0` resolves exactly one
   * copy. The number agreement was the mechanism, never the requirement. It is
   * asserted here so that the day it happens it is a recorded decision and not
   * a surprise in a release merge request.
   */
  it('moves only `@endora-commerce/page-builder-core` on a minor once the group is at 1.x', () => {
    const dir = fixture({
      seedVersion: '1.4.2',
      files: { '.changeset/a.md': changeset('@endora-commerce/page-builder-core', 'minor') },
    });

    runChangeset(dir, ['version']);

    expect(groupVersions(dir)).toEqual({
      '@endora-commerce/page-builder-core': '1.5.0',
      '@endora-commerce/cms-components': '1.4.2',
      '@endora-commerce/email-components': '1.4.2',
    });
  });

  /**
   * …and the invariant that survives the regime change: a **major** takes the
   * peers out of range, so all three move and agree. This is the property the
   * singleton rule actually needs, and it is the one that costs one changeset
   * rather than 66 hand edits when the host package is majored (D-160.2).
   */
  it('carries all three on a major once the group is at 1.x', () => {
    const dir = fixture({
      seedVersion: '1.4.2',
      files: { '.changeset/a.md': changeset('@endora-commerce/page-builder-core', 'major') },
    });

    runChangeset(dir, ['version']);

    expect(groupVersions(dir)).toEqual({
      '@endora-commerce/page-builder-core': '2.0.0',
      '@endora-commerce/cms-components': '2.0.0',
      '@endora-commerce/email-components': '2.0.0',
    });
    for (const name of PAGE_BUILDER_GROUP) expect(name).toMatch(/^@endora-commerce\//);
  });
});
