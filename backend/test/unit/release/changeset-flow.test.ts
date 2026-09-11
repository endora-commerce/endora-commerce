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
 *      release of `@endora-commerce/page-builder-core` carries the group — holds
 *      while the group is at **`0.x`**, where `workspace:^` resolves to a caret
 *      range no minor bump satisfies. At `1.x` the same minor leaves the peers
 *      satisfied, so it carries neither. Both regimes are asserted, because the
 *      second one arrives with the group's first major and nothing else in the
 *      repository would report it.
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
 * The `linked` group, read from the repository's own `.changeset/config.json`.
 *
 * It is **derived rather than written down**, and that is the repair this
 * constant exists in (D-100). It used to name three packages while the fixture
 * below copied the real configuration, which links four — `page-builder-admin`
 * joined and nothing said so, leaving the group's actual behaviour asserted
 * nowhere at all. A list here and a list there is two answers to one question
 * waiting to disagree, and they had.
 *
 * `linked` is an array of groups; this repository declares exactly one, and a
 * second would be a D-108 decision rather than a fact this fixture may absorb
 * silently, so anything else **refuses**.
 */
function linkedGroupFromConfig(): readonly string[] {
  const config = JSON.parse(
    readFileSync(join(REPO_ROOT, '.changeset/config.json'), 'utf8'),
  ) as { linked?: readonly (readonly string[])[] };
  const groups = config.linked ?? [];
  if (groups.length !== 1) {
    throw new Error(
      `changeset-flow: .changeset/config.json declares ${String(groups.length)} linked groups; ` +
        'this fixture measures one. A second group is a D-108 decision — assert it here rather ' +
        'than letting this file measure whichever sorted first.',
    );
  }
  return groups[0] ?? [];
}

const PAGE_BUILDER_GROUP = linkedGroupFromConfig();

/**
 * The directory under `packages/` that holds each package this fixture carries.
 *
 * Derived from the package **name**, and **refused** when the derivation does
 * not land on a manifest declaring that name — a module package lives a
 * directory deeper, so a linked member this fixture silently failed to create
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

/**
 * The library packages this fixture carries: `contracts`, plus every member of
 * the `linked` group. `api-client` was a member until D-202 deleted it.
 *
 * `contracts` is named because it is the subject of the private-package and
 * `changeset status` measurements below; the rest are the group, so the set
 * follows the configuration instead of a reader remembering to extend it.
 */
const LIBRARIES: readonly string[] = [
  'contracts',
  ...PAGE_BUILDER_GROUP.map(directoryOf),
];

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
 * the fourth `linked` member turned both measurements from a silence that had
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

/** `@endora-commerce/<x>` → its version, for every member the group covers. */
function groupVersions(dir: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    PAGE_BUILDER_GROUP.map((name) => [name, versionOf(dir, directoryOf(name))]),
  );
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
   * changed the moment the fourth `linked` member joined the fixture.
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
    const dir = fixture({
      seedVersion: BASE,
      files: { '.changeset/a.md': changeset('@endora-commerce/contracts', 'minor') },
    });

    runChangeset(dir, ['version']);

    expect(versionOf(dir, 'contracts')).toBe('0.1.0');
    expect(versionOf(dir, 'page-builder-core')).toBe('0.0.1');
  });
});

describe('the `linked` group — what it does, and what it does not', () => {
  /**
   * D-108's documented behaviour, in the regime the group is in — `0.x`, which
   * is where it has been since it was created and where `0.7.0` leaves it.
   */
  it('carries the whole group on a minor to `@endora-commerce/page-builder-core`, at 0.x', () => {
    const dir = fixture({
      seedVersion: BASE,
      files: { '.changeset/a.md': changeset('@endora-commerce/page-builder-core', 'minor') },
    });

    runChangeset(dir, ['version']);

    expect(groupVersions(dir)).toEqual({
      '@endora-commerce/page-builder-core': '0.1.0',
      '@endora-commerce/cms-components': '0.1.0',
      '@endora-commerce/email-components': '0.1.0',
      '@endora-commerce/page-builder-admin': '0.1.0',
    });
  });

  /**
   * **A patch does not stay local in `0.x`, and this is what the three-member
   * constant was hiding.** This case read *"moves only `cms-components`"* and
   * was true of the group as it was written down; over the group the
   * configuration actually declares, `page-builder-admin` moves with it.
   *
   * The mechanism is the same one the whole of D-225 turns on, one decimal
   * place further left: `^0.0.0` is `>=0.0.0 <0.0.1`, so even a **patch** takes
   * a caret peer out of range, and `page-builder-admin` peer-depends on
   * `cms-components`. At `0.0.x` every bump propagates to every dependent;
   * the seeding is what makes it visible here rather than a special case.
   *
   * `page-builder-core` and `email-components` stay put because nothing in the
   * group depends on `cms-components` except the admin package — so this is
   * still a measurement of `linked` *not* raising a package that is not already
   * in the release, which is the property it was written for.
   */
  it('moves `@endora-commerce/cms-components` and its dependents on a patch to it alone', () => {
    const dir = fixture({
      seedVersion: BASE,
      files: { '.changeset/a.md': changeset('@endora-commerce/cms-components', 'patch') },
    });

    runChangeset(dir, ['version']);

    expect(groupVersions(dir)).toEqual({
      '@endora-commerce/page-builder-core': '0.0.0',
      '@endora-commerce/cms-components': '0.0.1',
      '@endora-commerce/email-components': '0.0.0',
      '@endora-commerce/page-builder-admin': '0.0.1',
    });
  });

  /**
   * The regime change nothing else in the repository would report.
   *
   * `linked` raises a package that is **already in a release** to the group's
   * highest version; it never puts one there. What puts the rest of the group
   * into a `page-builder-core` release is their
   * `peerDependencies` range going out of range — and at `0.x`, `workspace:^`
   * resolves to a caret range a minor bump breaks. From `1.x` a minor no longer
   * does, so the group's numbers diverge. D-210's `0.7.0` is therefore *not* the
   * regime change: it moved the estate's digits and left this behaviour exactly
   * where it was.
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
      '@endora-commerce/page-builder-admin': '1.4.2',
    });
  });

  /**
   * …and the invariant that survives the regime change: a **major** takes the
   * peers out of range, so the whole group moves and agrees. This is the property the
   * singleton rule actually needs, and it is the one that costs one changeset
   * rather than 66 hand edits when the host package is majored (D-160.2).
   */
  it('carries the whole group on a major once the group is at 1.x', () => {
    const dir = fixture({
      seedVersion: '1.4.2',
      files: { '.changeset/a.md': changeset('@endora-commerce/page-builder-core', 'major') },
    });

    runChangeset(dir, ['version']);

    expect(groupVersions(dir)).toEqual({
      '@endora-commerce/page-builder-core': '2.0.0',
      '@endora-commerce/cms-components': '2.0.0',
      '@endora-commerce/email-components': '2.0.0',
      '@endora-commerce/page-builder-admin': '2.0.0',
    });
    for (const name of PAGE_BUILDER_GROUP) expect(name).toMatch(/^@endora-commerce\//);
  });
});
