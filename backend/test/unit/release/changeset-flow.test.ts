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
 *   2. **The `fixed` group is lockstep.** One changeset on any package moves
 *      every package the group covers to one number — the owner's ruling of
 *      2026-10-01 that every release publishes all of them together, because
 *      the internal pins are exact (S1). It replaced a `linked` group around
 *      the page builder, which only raised a package already in a release and
 *      whose agreement depended on the `0.x` caret regime; under `fixed` the
 *      regime no longer matters, and both regimes are asserted to say so.
 *
 * **Every fixture that asserts an absolute number seeds its own base version**,
 * and that is the repair rather than a style. This file read *"holds today
 * because every package sits at `0.0.0`"* and took the tree's numbers by
 * default, so D-210's first release — `0.7.0` set by hand across 79 manifests —
 * turned four of these measurements red for a reason that has nothing to do
 * with what they measure. A regime is what is under test; which regime the
 * repository happens to be in today is not, and reading it out of the tree
 * makes every future release falsify this file again.
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
 * The `fixed` group, read from the repository's own `.changeset/config.json`.
 *
 * Lockstep is one group: a second would be two numbers, which is a decision
 * against the owner's ruling of 2026-10-01 rather than a fact this fixture may
 * absorb, so anything else **refuses** — and so does a leftover `linked` group,
 * which changesets rejects beside an overlapping `fixed` one.
 */
function fixedGroupFromConfig(): readonly string[] {
  const config = JSON.parse(
    readFileSync(join(REPO_ROOT, '.changeset/config.json'), 'utf8'),
  ) as { fixed?: readonly (readonly string[])[]; linked?: readonly unknown[] };
  const groups = config.fixed ?? [];
  if (groups.length !== 1 || (config.linked ?? []).length !== 0) {
    throw new Error(
      `changeset-flow: .changeset/config.json declares ${String(groups.length)} fixed and ` +
        `${String((config.linked ?? []).length)} linked groups; lockstep is exactly one fixed ` +
        'group and no linked one.',
    );
  }
  return groups[0] ?? [];
}

const FIXED_GROUP = fixedGroupFromConfig();

/**
 * The packages this fixture carries, by name: a sample, not a statement of the
 * group. `contracts` and the page builder's four are chosen for their graph —
 * a leaf for the private-package measurements, peer dependencies in both
 * directions, and `contracts` depended on by `page-builder-core` — and every
 * one of them is covered by {@link FIXED_GROUP}, which is asserted below.
 */
const SAMPLE = [
  '@endora-commerce/contracts',
  '@endora-commerce/page-builder-core',
  '@endora-commerce/cms-components',
  '@endora-commerce/email-components',
  '@endora-commerce/page-builder-admin',
] as const;

/**
 * The directory under `packages/` that holds each package this fixture carries.
 *
 * Derived from the package **name**, and **refused** when the derivation does
 * not land on a manifest declaring that name — a module package lives a
 * directory deeper, so a sample package this fixture silently failed to create
 * would be a group member measured as absent rather than as unmoved, which is
 * the direction that agrees with a defect.
 */
function directoryOf(packageName: string): string {
  const directory = packageName.replace(/^@endora-commerce\//, '');
  const manifest = join(REPO_ROOT, 'packages', directory, 'package.json');
  if (!existsSync(manifest)) {
    throw new Error(
      `changeset-flow: ${packageName} does not resolve to packages/${directory}/package.json. ` +
        'This fixture creates its workspace from that path; place the package or teach the ' +
        'derivation where it lives.',
    );
  }
  const declared = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name;
  if (declared !== packageName) {
    throw new Error(
      `changeset-flow: packages/${directory}/package.json declares ${String(declared)}, not ` +
        `${packageName}.`,
    );
  }
  return directory;
}

/** The sample as directories under `packages/`. */
const LIBRARIES: readonly string[] = SAMPLE.map(directoryOf);

/**
 * The library this fixture makes private for the `privatePackages.version`
 * measurements — **derived as the one nothing else in the fixture depends on**.
 *
 * It has to be a leaf, and that is changesets' rule rather than a preference:
 * with `privatePackages.version` false a private package is *skipped*, and the
 * CLI refuses the whole run — *"Invalid tree: X depends on the skipped package
 * Y, but X is not skipped"*, exit 1 — rather than versioning a public dependent
 * against a version that will never exist. Measured, and it is how this
 * derivation came to be written: the subject was `email-components`, which is a
 * leaf only while `page-builder-admin` is missing from the fixture, and adding
 * the fourth page-builder package turned both measurements from a silence that had
 * not happened into a configuration error.
 *
 * So the subject is computed from the manifests the fixture actually carries.
 * Naming one would be the same derived-fact-written-down this file is being
 * repaired for (D-100), one layer down and with a worse failure: the run would
 * exit 1 for a reason that has nothing to do with `privatePackages`.
 */
function leafLibrary(): string {
  const manifests = LIBRARIES.map((directory) => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages', directory, 'package.json'), 'utf8'),
    ) as { name: string } & Record<string, Record<string, string> | undefined>;
    return { directory, manifest };
  });
  const dependedOn = new Set<string>();
  for (const { manifest } of manifests) {
    for (const field of ['dependencies', 'peerDependencies', 'devDependencies'] as const) {
      for (const name of Object.keys(manifest[field] ?? {})) dependedOn.add(name);
    }
  }
  const leaf = manifests.find(({ manifest }) => !dependedOn.has(manifest.name));
  if (leaf === undefined) {
    throw new Error(
      'changeset-flow: every library this fixture carries is depended on by another, so there ' +
        'is no package that can be made private without changesets refusing the tree. Add a ' +
        'leaf, or measure `privatePackages.version` over a fixture that is not this one.',
    );
  }
  return leaf.directory;
}

const PRIVATE_SUBJECT = leafLibrary();
const PRIVATE_SUBJECT_NAME = `@endora-commerce/${PRIVATE_SUBJECT}`;
const APPLICATIONS = ['backend', 'admin', 'storefront', 'docs'] as const;

/**
 * The base every **absolute-number** assertion in this file is measured from.
 *
 * `0.0.0`, because the numbers those tests name are arithmetic from it — and a
 * base this file fixes is the whole point. The tree's own version is a release
 * decision that moves (D-210 moved it to `0.7.0`, and four measurements here
 * went red for a reason that had nothing to do with the machinery they
 * measure). What is under test is the **regime**: `0.x`, where `workspace:^`
 * resolves to a caret range no minor bump satisfies. `0.7.0` is in that same
 * regime, so those four tests measured the same behaviour throughout and only
 * ever disagreed about the digits.
 */
const BASE = '0.0.0';

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

interface FixtureOptions {
  /**
   * Seed every library at this version.
   *
   * Defaults to whatever the tree says, which is the right default for a test
   * whose assertion is relative (*did this move at all?*) and the wrong one for
   * a test that names a number: the tree's version is a release decision that
   * moves, and D-210 moved it. Every absolute assertion below passes one.
   */
  readonly seedVersion?: string;
  /** Applied to a copy of the real `.changeset/config.json`. */
  readonly mutateConfig?: (config: Record<string, unknown>) => void;
  /**
   * Libraries to mark `"private": true` in the fixture.
   *
   * `privatePackages.version` governs **private** packages, so the two
   * measurements below are only available over one — and since the owner's
   * publication ruling of 2026-09-05 there is no private versionable package
   * left in this repository to borrow. The precondition therefore belongs in
   * the fixture rather than in the tree, which is also the more honest place
   * for it: those tests measure what changesets does to a private package, and
   * a fixture that got that state by accident of the day it ran is a test
   * measuring the calendar.
   */
  readonly privateLibraries?: readonly string[];
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
    if (options.privateLibraries?.includes(name) === true) manifest['private'] = true;
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

/** `@endora-commerce/<x>` → its version, for every package in the sample. */
function sampleVersions(dir: string): Readonly<Record<string, string>> {
  return Object.fromEntries(SAMPLE.map((name) => [name, versionOf(dir, directoryOf(name))]));
}

/** Every package in the sample at `version`. */
const allAt = (version: string): Readonly<Record<string, string>> =>
  Object.fromEntries(SAMPLE.map((name) => [name, version]));

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
   * The headline measurement. Every versionable package but the handful feature
   * 104 published is `"private": true`, and `@changesets/config@4` defaults
   * `privatePackages` to
   * `false`; with it false, `changeset version` reports success and moves
   * nothing, leaving the changeset file on disk to be consumed by a release
   * that will never come.
   *
   * The subject is **derived** (`leafLibrary`) and made private **by the
   * fixture**, and both halves of that are corrections to how this pair used to
   * be written. It was `contracts` until feature 104 published that, then
   * `email-components` until the publication ruling of 2026-09-05 published
   * every versionable package — at which point there was no private one left to
   * borrow and both cases went green for the wrong reason, reporting a `minor`
   * bump that had happened rather than a silence that had not. `privatePackages`
   * governs **private** packages, so the precondition belongs where the
   * measurement is. And the *name* is no longer written here either: a private
   * package with a public dependent makes changesets refuse the whole tree, so
   * the subject has to be a leaf of the fixture's own graph — a fact that
   * changed the moment the fourth page-builder package joined the fixture.
   */
  it('bumps nothing, exits 0 and keeps the changeset when it is `false`', () => {
    const dir = fixture({
      privateLibraries: [PRIVATE_SUBJECT],
      mutateConfig: (config) => {
        config['privatePackages'] = { version: false, tag: false };
      },
      files: { '.changeset/a.md': changeset(PRIVATE_SUBJECT_NAME, 'minor') },
    });
    const before = versionOf(dir, PRIVATE_SUBJECT);

    const run = runChangeset(dir, ['version']);

    expect(run.status).toBe(0);
    expect(versionOf(dir, PRIVATE_SUBJECT)).toBe(before);
    expect(existsSync(join(dir, '.changeset/a.md'))).toBe(true);
  });

  it('does the same when the block is omitted, which is the literal default', () => {
    const dir = fixture({
      privateLibraries: [PRIVATE_SUBJECT],
      mutateConfig: (config) => {
        delete config['privatePackages'];
      },
      files: { '.changeset/a.md': changeset(PRIVATE_SUBJECT_NAME, 'minor') },
    });
    const before = versionOf(dir, PRIVATE_SUBJECT);

    expect(runChangeset(dir, ['version']).status).toBe(0);
    expect(versionOf(dir, PRIVATE_SUBJECT)).toBe(before);
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
      seedVersion: BASE,
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
   * `updateInternalDependencies: "patch"` is no longer what carries a
   * dependent: under the `fixed` group a release of `contracts` is a release of
   * every package, at its number. `page-builder-core` depends on `contracts` at
   * `workspace:*`, and it no longer gets a patch of its own — it gets the set's
   * number.
   */
  it('carries a dependent on a `@endora-commerce/contracts` release at the same number', () => {
    const dir = fixture({
      seedVersion: BASE,
      files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') },
    });

    runChangeset(dir, ['version']);

    expect(versionOf(dir, 'contracts')).toBe('0.1.0');
    expect(versionOf(dir, 'page-builder-core')).toBe('0.1.0');
  });
});

describe('the `fixed` group — every release, one number', () => {
  it('covers every package in the sample, and is the one group', () => {
    for (const name of SAMPLE) {
      expect(
        FIXED_GROUP.some((entry) => entry === name || (entry.endsWith('/*') && name.startsWith(entry.slice(0, -1)))),
        name,
      ).toBe(true);
    }
  });

  /**
   * The release this ruling was made for: `0.100.0` is published, and a patch
   * to one package is `0.100.1` for all of them — not `0.100.1` for most and
   * `0.101.0` for whichever carried a stale `minor`.
   */
  it('moves every package to the next patch on a patch to one of them', () => {
    const dir = fixture({
      seedVersion: '0.100.0',
      files: { '.changeset/a.md': changeset('@endora-commerce/cms-components', 'patch') },
    });

    expect(runChangeset(dir, ['version']).status).toBe(0);
    expect(sampleVersions(dir)).toEqual(allAt('0.100.1'));
  });

  it('takes the highest bump across the release, for every package', () => {
    const dir = fixture({
      seedVersion: '0.100.0',
      files: {
        '.changeset/a.md': changeset('@endora-commerce/cms-components', 'patch'),
        '.changeset/b.md': changeset('@endora-commerce/contracts', 'minor'),
      },
    });

    runChangeset(dir, ['version']);

    expect(sampleVersions(dir)).toEqual(allAt('0.101.0'));
  });

  /**
   * The regime the `linked` group depended on no longer matters: at `1.x` a
   * minor to `page-builder-core` leaves every caret peer in range, and the
   * whole set still moves together.
   */
  it('moves every package on a minor at 1.x too', () => {
    const dir = fixture({
      seedVersion: '1.4.2',
      files: { '.changeset/a.md': changeset('@endora-commerce/page-builder-core', 'minor') },
    });

    runChangeset(dir, ['version']);

    expect(sampleVersions(dir)).toEqual(allAt('1.5.0'));
  });
});
