import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  analyzeReleaseIntent,
  checkPublishedSurfaceIntent,
  checkReleaseIntent,
  compilesPath,
  groupMembers,
  matchesPattern,
  matchesTsGlob,
  normalizeRelative,
  parseChangeset,
  readPublishedSurface,
  readReleaseIntent,
  unreadablePattern,
  type BranchDiff,
  type ReleaseIntentFinding,
  type ReleaseIntentFindingKind,
} from '../../../scripts/check-release-intent.js';
import { nodeWorkspaceFs } from '../../../scripts/lib/workspace-packages.js';
import {
  checkout,
  configuredAs,
  FIXTURE_ROOT,
  HOST_SOURCED_PACKAGE,
  type FileMap,
} from '../../helpers/release-intent-check-fixture.js';

/**
 * Companion test for `check-release-intent` (feature 080, T043).
 *
 * The check exists because the release gate's failure mode is **silence**:
 * every way `.changeset/config.json` can be wrong makes `changeset status` exit
 * 0 with an empty release plan, which is byte-identical to a clean branch. So
 * the shapes asserted here are not "does it find a violation" — they are the
 * eight distinct ways the flow stops asking, each proven separately, because a
 * check that went blind on seven of them behind the eighth's red would read
 * exactly as green as this file's subject does today.
 *
 * Every fixture is a whole synthetic checkout. The derivation under test is
 * *which workspace entries produce a library family and which name one
 * application*, and a fixture that pre-declared that answer would leave it
 * unproven — which matters more than usual here, because the answer has to
 * survive 66 module packages arriving under a second scope and a directory
 * deeper (D-160.2).
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function findings(overrides: Parameters<typeof checkout>[0] = {}): readonly ReleaseIntentFinding[] {
  const tree = checkout(overrides);
  const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
  if ('reason' in result) {
    throw new Error(`expected a verdict, got a refusal: ${result.reason}`);
  }
  return result.findings;
}

function refusal(overrides: Parameters<typeof checkout>[0] = {}): string {
  const tree = checkout(overrides);
  const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
  if (!('reason' in result)) {
    throw new Error(`expected a refusal, got ${String(result.findings.length)} finding(s)`);
  }
  return result.reason;
}

const kinds = (found: readonly ReleaseIntentFinding[]): readonly ReleaseIntentFindingKind[] =>
  found.map((finding) => finding.kind);

describe('check-release-intent — the default checkout passes', () => {
  it('reports nothing for a workspace whose configuration is right', () => {
    expect(findings()).toEqual([]);
  });

  /**
   * The proofs above can only show the analyser *can* go red. This is the other
   * half: the tree CI actually runs it over is clean, so a green in the
   * pipeline is a statement about this repository and not about a fixture.
   */
  it('reports nothing for this repository, which is the tree CI runs it over', () => {
    const result = checkReleaseIntent(REPO_ROOT.replace(/\/$/, ''), nodeWorkspaceFs(), (dir) =>
      readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name),
    );
    expect('reason' in result ? result.reason : kinds(result.findings)).toEqual([]);
  });
});

describe('check-release-intent — the four lines that look like boilerplate', () => {
  /**
   * The headline. Measured against the real five manifests with a branch that
   * changes `packages/contracts/src/index.ts` and carries no changeset:
   * `version: true` exits 1, `version: false` exits 0 with an empty plan, and
   * the block deleted exits 0 too. Nothing in the repository read those four
   * lines before this check.
   */
  it('reports `privatePackages.version: false` — the config default', () => {
    const found = findings(
      configuredAs((config) => {
        config['privatePackages'] = { version: false, tag: false };
      }),
    );
    expect(kinds(found)).toContain('version-disabled');
  });

  it('reports `privatePackages` omitted entirely, which is the same value', () => {
    const found = findings(
      configuredAs((config) => {
        delete config['privatePackages'];
      }),
    );
    expect(kinds(found)).toContain('version-disabled');
  });

  it('says which setting and what it is, not merely that something is wrong', () => {
    const found = findings(
      configuredAs((config) => {
        config['privatePackages'] = { version: false, tag: false };
      }),
    );
    const finding = found.find((candidate) => candidate.kind === 'version-disabled');
    expect(finding?.subject).toBe('privatePackages.version');
    expect(finding?.message).toContain('@changesets/config@4');
  });

  /**
   * The discrimination: the requirement is derived from the manifests, not
   * asserted. A workspace whose library packages are all public does not need
   * `privatePackages.version` at all, and demanding it there would be a rule
   * about a value rather than about a consequence.
   */
  it('does not require the setting when no versionable package is private', () => {
    const found = findings({
      ...configuredAs((config) => {
        config['privatePackages'] = { version: false, tag: true };
      }),
      'packages/alpha/package.json': '{ "name": "@fx/alpha", "version": "1.0.0" }',
      'packages/beta/package.json': '{ "name": "@fx/beta", "version": "1.0.0" }',
    });
    expect(kinds(found)).not.toContain('version-disabled');
    expect(kinds(found)).not.toContain('tag-without-publication');
  });
});

describe('check-release-intent — publication, and the tag question it carries', () => {
  it('reports a versionable package that is no longer private (D-160.5)', () => {
    const found = findings({
      'packages/alpha/package.json': '{ "name": "@fx/alpha", "version": "1.0.0" }',
    });
    expect(kinds(found)).toContain('publishable-package');
    expect(found.find((f) => f.kind === 'publishable-package')?.subject).toBe('@fx/alpha');
  });

  /**
   * An application is not a package anybody installs, so `private` on it is not
   * this rule's business. Proven as a discrimination because widening the
   * predicate to every member would fire on `backend`, `admin`, `storefront`
   * and `docs` — and be switched off within a day.
   */
  it('does not report an application that is not private', () => {
    const found = findings({ 'apps/host/package.json': '{ "name": "host", "version": "0.0.0" }' });
    expect(kinds(found)).not.toContain('publishable-package');
  });

  it('reports tagging turned on while nothing is published', () => {
    const found = findings(
      configuredAs((config) => {
        config['privatePackages'] = { version: true, tag: true };
      }),
    );
    expect(kinds(found)).toContain('tag-without-publication');
  });

  /**
   * The coupling that makes the tag answer enforced rather than a paragraph:
   * the day a package stops being private, `privatePackages.tag` stops being
   * required to be `false`, and `publishable-package` is what puts a human in
   * front of the decision in that same merge request.
   */
  it('stops requiring `tag: false` once a versionable package is publishable', () => {
    const found = findings({
      ...configuredAs((config) => {
        config['privatePackages'] = { version: true, tag: true };
      }),
      'packages/alpha/package.json': '{ "name": "@fx/alpha", "version": "1.0.0" }',
    });
    expect(kinds(found)).not.toContain('tag-without-publication');
    expect(kinds(found)).toContain('publishable-package');
  });
});

describe('check-release-intent — the ignore list, both directions', () => {
  /**
   * The 67-package failure mode, written as it would actually arrive: one
   * `ignore` entry under the new scope, and every module package silently
   * stops needing a changeset while `changeset status` goes on exiting 0.
   */
  it('reports a scope-wide ignore that swallows a library family', () => {
    const found = findings(
      configuredAs((config) => {
        config['ignore'] = ['host', '@fx/*'];
      }),
    );
    expect(kinds(found).filter((kind) => kind === 'ignored-family-member')).toHaveLength(2);
  });

  it('reports an application that no ignore pattern covers', () => {
    const found = findings(
      configuredAs((config) => {
        config['ignore'] = [];
      }),
    );
    expect(kinds(found)).toContain('unignored-application');
    expect(found.find((f) => f.kind === 'unignored-application')?.subject).toBe('host');
  });

  it('reports an ignore entry that matches no package at all', () => {
    const found = findings(
      configuredAs((config) => {
        // A path written where a name belongs. `ignore` is glob-matched against
        // names, so this matches nothing and `host` stops being ignored — which
        // is the second finding, and the reason a typo here fails safe.
        config['ignore'] = ['packages/*'];
      }),
    );
    expect(kinds(found)).toContain('stale-ignore-entry');
    expect(kinds(found)).toContain('unignored-application');
  });

  /**
   * A member matched by both a literal entry and a family glob counts as
   * family. That is the failing-safe direction — a versionable package demands
   * a changeset and an ignored one demands nothing — and a fixture is the only
   * thing that keeps it from being flipped by a plausible-looking edit.
   */
  it('treats a member matched by both a literal and a glob entry as family', () => {
    const found = findings({
      'pnpm-workspace.yaml': 'packages:\n  - apps/host\n  - packages/alpha\n  - packages/*\n',
      ...configuredAs((config) => {
        config['ignore'] = ['host', '@fx/alpha'];
      }),
    });
    expect(kinds(found)).toContain('ignored-family-member');
    expect(kinds(found)).not.toContain('unignored-application');
  });
});

describe('check-release-intent — groups and written intent', () => {
  it('reports a linked group naming a package that is not a member', () => {
    const found = findings(
      configuredAs((config) => {
        config['linked'] = [['@fx/alpha', '@fx/gone']];
      }),
    );
    expect(kinds(found)).toContain('stale-group-member');
    expect(found.find((f) => f.kind === 'stale-group-member')?.subject).toBe('@fx/gone');
  });

  it('reads `fixed` groups as well as `linked` ones', () => {
    const found = findings(
      configuredAs((config) => {
        config['fixed'] = [['@fx/absent']];
      }),
    );
    expect(found.find((f) => f.kind === 'stale-group-member')?.subject).toBe('@fx/absent');
  });

  it('reports a changeset naming a package that is not a member', () => {
    const found = findings({ '.changeset/x.md': '---\n"@fx/nope": minor\n---\n\nsomething\n' });
    expect(kinds(found)).toContain('unversionable-changeset');
  });

  it('reports a changeset naming an ignored package, whose bump will never apply', () => {
    const found = findings({ '.changeset/x.md': '---\n"host": minor\n---\n\nsomething\n' });
    expect(kinds(found)).toContain('unversionable-changeset');
  });

  /**
   * An empty changeset — `pnpm changeset --empty` — names no package and is the
   * sanctioned way to say "no release meaning". It must not be a finding, or
   * the escape hatch the whole gate depends on becomes unusable.
   */
  it('does not report an empty changeset', () => {
    expect(findings({ '.changeset/x.md': '---\n---\n\n' })).toEqual([]);
  });

  it('reads the front matter and not the prose below it', () => {
    const releases = parseChangeset(
      'x.md',
      '---\n"@fx/alpha": minor\n---\n\nRenamed `thing: patch` in the docs, see @fx/beta: no change.\n',
    );
    expect(releases).toEqual([{ file: 'x.md', packageName: '@fx/alpha', bump: 'minor' }]);
  });
});

describe('check-release-intent — six ways it refuses to report on what it did not read', () => {
  it('refuses a missing `.changeset/config.json`', () => {
    expect(refusal({ '.changeset/config.json': null })).toContain('missing');
  });

  it('refuses a `.changeset/config.json` that does not parse', () => {
    expect(refusal({ '.changeset/config.json': '{ nope' })).toContain('does not parse');
  });

  /**
   * `workspace-packages.ts` is a block-sequence reader, so a flow-style list
   * yields no globs. That must be a refusal and not an empty workspace: an
   * empty one makes every question above vacuously true.
   */
  it('refuses a flow-style `pnpm-workspace.yaml`', () => {
    expect(refusal({ 'pnpm-workspace.yaml': 'packages: [apps/host, packages/*]\n' })).toContain(
      'no `packages:` entries',
    );
  });

  it('refuses a workspace whose globs match no package', () => {
    expect(
      refusal({
        'apps/host/package.json': null,
        'packages/alpha/package.json': null,
        'packages/beta/package.json': null,
      }),
    ).toContain('matched no package');
  });

  /**
   * Issue #215 over this population. The library tree moving does not empty the
   * walk — the application manifests are still there, and every predicate above
   * still answers over them — so the floor is per workspace entry.
   */
  it('refuses when one workspace entry produced no member — the short walk', () => {
    expect(
      refusal({ 'packages/alpha/package.json': null, 'packages/beta/package.json': null }),
    ).toContain('residue of its population');
  });

  it('refuses an ignore pattern in a grammar it does not implement', () => {
    expect(
      refusal(
        configuredAs((config) => {
          config['ignore'] = ['{backend,admin}'];
        }),
      ),
    ).toContain('glob grammar');
  });
});

describe('check-release-intent — the pattern reader', () => {
  /**
   * `@` and `+` are metacharacters in micromatch **only** before a `(`. A
   * reader that refused them outright would refuse `@endora-commerce/*`, which
   * is precisely the pattern the most valuable finding exists to catch — and
   * an exit 2 an author clears by removing the check from the job.
   */
  it('reads a scope wildcard, which is what the 67-package case looks like', () => {
    expect(unreadablePattern(['@endora-commerce/*'])).toBeNull();
    expect(matchesPattern('@endora-commerce/*', '@endora-commerce/blog')).toBe(true);
    // The negative case has to be a name in *another* scope, and `@endora/` is
    // the one that matters: it is reserved for the company's other npm packages
    // (D-153, D-161), so a reader that matched across the hyphen would ignore a
    // package this repository does not own. It used to be `@b2b/contracts` —
    // this workspace's own second scope until T042e renamed the five packages,
    // which left the assertion with no scope to be other than.
    expect(matchesPattern('@endora-commerce/*', '@endora/contracts')).toBe(false);
  });

  it('matches across the scope separator, because a name is not a path', () => {
    expect(matchesPattern('@fx/*', '@fx/alpha')).toBe(true);
    expect(matchesPattern('*', 'anything')).toBe(true);
  });

  it('names the constructs it cannot read rather than matching them badly', () => {
    expect(unreadablePattern(['a{b,c}'])).toBe('a{b,c}');
    expect(unreadablePattern(['!backend'])).toBe('!backend');
    expect(unreadablePattern(['@(a|b)'])).toBe('@(a|b)');
    expect(unreadablePattern(['[ab]'])).toBe('[ab]');
  });
});

describe('check-release-intent — what it reads, beside what it finds', () => {
  it('counts the files it opened and the decisions it took inside them', () => {
    const tree = checkout({ '.changeset/x.md': '---\n"@fx/alpha": minor\n---\n\nsomething\n' });
    const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in result) throw new Error(result.reason);
    // config.json + pnpm-workspace.yaml + three manifests. **Not the changeset**
    // — see the pair below.
    expect(result.inputs.files).toBe(5);
    // three members, one ignore pattern, two linked members, two settings.
    expect(result.sites).toBe(8);
    expect(result.coverage).toEqual([{ source: 'workspace-globs', expected: 2, covered: 2 }]);
  });

  /**
   * The reported size must not move with the number of pending changesets, and
   * this pair is why the numbers above are what they are.
   *
   * Both counts used to fold in `.changeset/*.md`, whose population follows the
   * release cycle rather than the repository. Measured on `a059e56e`: at 30
   * pending changesets `files` was 51, sitting exactly on its recorded band's
   * +50% ceiling, so the next merge request to add one failed — and a release
   * consuming all thirty would have dropped it to 17, under the −10% floor, in
   * the same week. A band cannot bound a quantity that oscillates in both
   * directions.
   *
   * The changesets are still read and still judged; they are reported beside
   * these numbers as `changesets=`, which is the figure that is *supposed* to
   * move with the release cycle.
   */
  it('reports the same size whether there are no changesets or many', () => {
    const size = (files: Record<string, string>): { files: number; sites: number } => {
      const tree = checkout(files);
      const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
      if ('reason' in result) throw new Error(result.reason);
      return { files: result.inputs.files, sites: result.sites };
    };

    const none = size({});
    const many = size(
      Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `.changeset/c${i}.md`,
          '---\n"@fx/alpha": patch\n---\n\nsomething\n',
        ]),
      ),
    );

    expect(many).toEqual(none);
  });

  it('still reads the changesets it does not count', () => {
    const tree = checkout({
      '.changeset/a.md': '---\n"@fx/alpha": minor\n---\n\none\n',
      '.changeset/b.md': '---\n"@fx/alpha": patch\n---\n\ntwo\n',
    });
    const result = checkReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in result) throw new Error(result.reason);
    // Excluding them from the reported size must not turn into not reading
    // them, which is the failure this whole read-size discipline exists for.
    expect(result.inputs.changesets).toHaveLength(2);
  });
});

describe('the release-gate suite is still run by something', () => {
  /**
   * `backend/test/release/` is excluded from both backend vitest configs
   * because it needs **git**, which `node:22.17-slim` does not ship — so its
   * one caller is a line in `release:changeset`. A root nothing runs is a test
   * file that has quietly stopped being a gate, and it would look exactly like
   * a green pipeline. This is the two-way link, in a suite that runs on every
   * merge request regardless of what the diff touches.
   */
  it('is named by the `release:changeset` job', () => {
    const ci = readFileSync(`${REPO_ROOT}.gitlab-ci.yml`, 'utf8');
    expect(ci).toContain('pnpm --filter backend run test:release-gate');
  });

  it('has a config, a script and at least one file to run', () => {
    const scripts = JSON.parse(
      readFileSync(`${REPO_ROOT}backend/package.json`, 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(scripts.scripts['test:release-gate']).toContain('vitest.release.config.ts');
    expect(
      readdirSync(`${REPO_ROOT}backend/test/release`).filter((name) => name.endsWith('.test.ts')),
    ).not.toEqual([]);
  });
});

describe('check-release-intent — the analysis is pure over what the reader produced', () => {
  /**
   * The CLI and every proof above run one function over one shape. This asserts
   * the seam itself, so a future refactor cannot leave the CLI analysing
   * something the proofs never see.
   */
  it('gives the same findings through the reader as through the whole check', () => {
    const overrides = configuredAs((config) => {
      config['privatePackages'] = { version: false, tag: false };
    });
    const tree = checkout(overrides);
    const inputs = readReleaseIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets);
    if ('reason' in inputs) throw new Error(inputs.reason);
    expect(kinds(analyzeReleaseIntent(inputs))).toEqual(kinds(findings(overrides)));
  });

  it('collects every group member from both `linked` and `fixed`', () => {
    expect(groupMembers({ linked: [['a', 'b']], fixed: [['c']] })).toEqual(['a', 'b', 'c']);
    expect(groupMembers({})).toEqual([]);
  });
});

/**
 * `--since` — the finding `changeset status` structurally cannot produce.
 *
 * The CLI attributes a changed file to a package by the package's own
 * directory. `@endora-commerce/platform` compiles `backend/src`, so on !891's
 * branch a commit editing a file the host publishes exits 0 and a commit editing
 * `packages/platform/README.md`, which ships in nothing, exits 1. The fixture
 * reproduces that shape as a *configuration* — two tsconfigs, with `include` in
 * the extended one — so the derivation under test runs rather than being handed
 * its own answer.
 */
describe('check-release-intent --since — a published surface the gate cannot see', () => {
  const diff = (
    changedPaths: readonly string[],
    addedChangesets: readonly string[] = [],
    containedInBaseline = false,
  ): BranchDiff => ({ baseline: 'origin/master', containedInBaseline, changedPaths, addedChangesets });

  function surfaceFindings(overrides: FileMap, branch: BranchDiff): readonly ReleaseIntentFinding[] {
    const tree = checkout(overrides);
    const result = checkPublishedSurfaceIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets, branch);
    if ('contained' in result) throw new Error('expected a verdict, got a containment answer');
    if ('reason' in result) throw new Error(`expected a verdict, got a refusal: ${result.reason}`);
    return result.findings;
  }

  function surfaceRefusal(overrides: FileMap, branch: BranchDiff): string {
    const tree = checkout(overrides);
    const result = checkPublishedSurfaceIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets, branch);
    if (!('reason' in result)) throw new Error('expected a refusal, got a verdict');
    return result.reason;
  }

  function surfaceContainment(overrides: FileMap, branch: BranchDiff): string {
    const tree = checkout(overrides);
    const result = checkPublishedSurfaceIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets, branch);
    if (!('contained' in result)) throw new Error('expected a containment answer, got a verdict');
    return result.contained;
  }

  it('reports a change to a package whose sources live in an ignored application', () => {
    const found = surfaceFindings(
      HOST_SOURCED_PACKAGE,
      diff(['apps/host/src/kernel/settings/settings-cache.ts']),
    );

    expect(kinds(found)).toEqual(['unattributed-published-change']);
    expect(found[0]?.subject).toBe('@fx/beta');
    expect(found[0]?.message).toContain('apps/host/src/kernel/settings/settings-cache.ts');
  });

  it('reports nothing once the branch carries a changeset', () => {
    expect(
      surfaceFindings(
        HOST_SOURCED_PACKAGE,
        diff(['apps/host/src/kernel/settings/settings-cache.ts'], ['.changeset/a.md']),
      ),
    ).toEqual([]);
  });

  /**
   * The other half of the inversion, and why this is a *second* question rather
   * than a replacement: a change inside the package's own directory is already
   * the CLI's, and reporting it here would demand a changeset twice.
   */
  it('says nothing about a change the CLI can already attribute', () => {
    expect(surfaceFindings({}, diff(['packages/alpha/src/index.ts']))).toEqual([]);
  });

  it('says nothing about an application file no package compiles', () => {
    expect(surfaceFindings(HOST_SOURCED_PACKAGE, diff(['apps/host/src/routes/index.ts']))).toEqual([]);
  });

  /** `exclude` is part of the compilation, so a test file the build drops is not published. */
  it('honours `exclude`, so a file the build drops is not a published change', () => {
    expect(
      surfaceFindings(HOST_SOURCED_PACKAGE, diff(['apps/host/src/kernel/settings/cache.test.ts'])),
    ).toEqual([]);
  });

  it('refuses a versionable package whose build configuration it cannot read', () => {
    expect(
      surfaceRefusal({ 'packages/alpha/tsconfig.build.json': null }, diff(['apps/host/src/a.ts'])),
    ).toContain('could not be read');
  });

  it('refuses a build configuration whose `extends` chain declares no `include`', () => {
    expect(
      surfaceRefusal(
        { 'packages/alpha/tsconfig.build.json': '{ "compilerOptions": { "rootDir": "./src" } }' },
        diff(['apps/host/src/a.ts']),
      ),
    ).toContain('declare no `include`');
  });

  it('refuses an `extends` it cannot follow rather than reading it as absent', () => {
    expect(
      surfaceRefusal(
        { 'packages/alpha/tsconfig.build.json': '{ "extends": "@fx/tsconfig/base" }' },
        diff(['apps/host/src/a.ts']),
      ),
    ).toContain('not a relative path');
  });

  it('refuses a branch with an empty diff rather than reporting a vacuous pass', () => {
    expect(surfaceRefusal({}, diff([]))).toContain('changes no file at all');
  });

  /**
   * The split pipeline 11491 forced (see `ReleaseIntentContainment`): an empty
   * diff is two different facts, and only one of them is a refusal. Driven here
   * as well as over real branches in `test/release/changeset-gate.test.ts`,
   * because the branch that decides it lives at the top of the analysis and a
   * red proof has to be able to enter where a real run enters.
   */
  describe('an empty diff is two facts', () => {
    it('answers rather than refuses when the baseline already contains the branch', () => {
      const message = surfaceContainment({}, diff([], [], true));

      expect(message).toContain('already contained in `origin/master`');
      expect(message).toContain('adds no file to it');
    });

    it('keeps refusing an empty diff from a branch the baseline does not contain', () => {
      const reason = surfaceRefusal({}, diff([], [], false));

      expect(reason).toContain('changes no file at all');
      expect(reason).toContain('not already contained in `origin/master`');
    });

    /**
     * Containment is answered before anything is read, so a checkout this mode
     * could not otherwise judge — an unreadable build configuration, an empty
     * workspace — does not turn a contained branch into a refusal. There is
     * nothing to attribute either way, and the config half runs in `quality`.
     */
    it('answers containment before it reads the workspace at all', () => {
      expect(
        surfaceContainment({ 'packages/alpha/tsconfig.build.json': null }, diff([], [], true)),
      ).toContain('already contained');
    });

    /** The ref is the one that was measured against, never a name written down. */
    it('names the baseline it was given', () => {
      const tree = checkout({});
      const result = checkPublishedSurfaceIntent(FIXTURE_ROOT, tree.fs, tree.listChangesets, {
        baseline: 'origin/release-2026-09',
        containedInBaseline: true,
        changedPaths: [],
        addedChangesets: [],
      });

      if (!('contained' in result)) throw new Error('expected a containment answer');
      expect(result.contained).toContain('`origin/release-2026-09`');
    });
  });
});

describe('check-release-intent --since — the derivation underneath', () => {
  it('resolves a build configuration through its `extends`', () => {
    const tree = checkout(HOST_SOURCED_PACKAGE);
    const surface = readPublishedSurface(FIXTURE_ROOT, 'packages/beta', '@fx/beta', tree.fs);
    if ('reason' in surface) throw new Error(surface.reason);

    expect(surface.include).toEqual(['apps/host/src/kernel/**/*']);
    expect(surface.exclude).toContain('apps/host/src/**/*.test.ts');
    // `dist` is never a source: a rebuilt artefact is not a published change.
    expect(surface.exclude).toContain('packages/beta/dist');
    expect(compilesPath(surface, 'apps/host/src/kernel/a.ts')).toBe(true);
    expect(compilesPath(surface, 'apps/host/src/kernel/a.test.ts')).toBe(false);
    expect(compilesPath(surface, 'apps/host/src/http/a.ts')).toBe(false);
  });

  it('reads the three tsconfig glob constructs, and a bare directory as all of it', () => {
    expect(matchesTsGlob('src/**/*', 'src/a/b/c.ts')).toBe(true);
    expect(matchesTsGlob('src/**/*', 'src/a.ts')).toBe(true);
    expect(matchesTsGlob('src/**/*', 'test/a.ts')).toBe(false);
    expect(matchesTsGlob('src/*.ts', 'src/a/b.ts')).toBe(false);
    expect(matchesTsGlob('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matchesTsGlob('src/a?.ts', 'src/ab.ts')).toBe(true);
    expect(matchesTsGlob('src', 'src/a/b.ts')).toBe(true);
    expect(matchesTsGlob('src/**/*.test.ts', 'src/a/b.test.ts')).toBe(true);
    expect(matchesTsGlob('src/**/*.test.ts', 'src/a/b.ts')).toBe(false);
  });

  it('collapses `..` without asking the filesystem where the checkout is', () => {
    expect(normalizeRelative('packages/platform/../../backend/src/kernel/**/*')).toBe(
      'backend/src/kernel/**/*',
    );
    expect(normalizeRelative('packages/alpha/./src/**/*')).toBe('packages/alpha/src/**/*');
  });

  /**
   * The tree CI runs it over, so a green in the pipeline is a statement about
   * this repository: every versionable package resolves, and each publishes only
   * its own directory today — which is exactly what makes the host package's
   * arrival the change this mode exists for.
   */
  it('resolves every versionable package in this repository', () => {
    const result = checkPublishedSurfaceIntent(
      REPO_ROOT.replace(/\/$/, ''),
      nodeWorkspaceFs(),
      (dir) =>
        readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name),
      {
        baseline: 'origin/master',
        containedInBaseline: false,
        changedPaths: ['README.md'],
        addedChangesets: [],
      },
    );
    if ('contained' in result) throw new Error('expected a verdict, got a containment answer');
    if ('reason' in result) throw new Error(result.reason);

    expect(result.surfaces.length).toBeGreaterThan(0);
    expect(result.coverage).toEqual([
      {
        source: 'versionable-packages',
        expected: result.surfaces.length,
        covered: result.surfaces.length,
      },
    ]);
    expect(result.findings).toEqual([]);
  });
});
