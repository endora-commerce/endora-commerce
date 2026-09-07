import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  nodeWorkspaceFs,
  workspaceMembers,
} from '../../../scripts/lib/workspace-packages.js';
import { commandLines, readJobs } from '../../helpers/ci-jobs.js';
import {
  keyOf,
  pipelineCoverage,
  repositoryScriptFile,
  repositoryScripts,
  ROOT_MEMBER,
  selectorMatches,
  type Coverage,
  type ScriptMember,
} from '../../helpers/ci-gate-coverage.js';

/**
 * A gate this repository wrote is run by a job, or somebody has written down why
 * it is not.
 *
 * ## The defect
 *
 * `manifests:check` — the two-way gate over the 70 generated module-package
 * manifests — appeared in no CI job for as long as it existed.
 * `grep -c 'manifests:check' .gitlab-ci.yml` was **0**, and on 2026-09-05 it was
 * red on `master` with 70 stale manifests after a release commit set versions by
 * hand. Nothing in any pipeline said so; a developer running it locally found it.
 *
 * That is issue #113's shape one level up. #113 is "a green that means *not
 * looking*"; this is a gate **nobody runs at all**, whose green is not even
 * claimed. Four more scripts were in the same state and are classified below.
 *
 * ## Why `check-inventory.test.ts` could not see it
 *
 * That file already reconciles gates against jobs — every entry carries a `job`
 * field held to the `quality` and `quality:static` command blocks in both
 * directions — and it is complete over **its** population. The population is the
 * problem: `check-*.ts` files under `backend/scripts`, `check-*.sh` under
 * `scripts`, and package scripts named `check:*`. `manifests:check` is a package
 * script called `manifests:check` running a file called
 * `generate-module-manifests.ts`, so it is none of the three.
 *
 * **A population keyed on a naming habit is defined by the presence of the
 * habit** — issue #244's finding, applied to the inventory that enforces #244.
 * So the population here is keyed on what a script *runs*.
 *
 * ## The population, and why it is this one
 *
 * Every package script, of every workspace member **and of the repository
 * root**, whose command runs a repository script file — `tsx`, `node`, `bash` or
 * `sh` over a path under a `scripts/` directory. Derived from the manifests
 * `pnpm-workspace.yaml` globs plus the root's own, never a list; 62 scripts
 * today, across `backend`, `storefront`, `packages/platform`,
 * `packages/modules/product_feeds` and the root.
 *
 * What it leaves out is the **toolchain**, not a rule. A script that runs the
 * application (`src/cli.ts`, `src/db/migrate.ts`, `src/lifecycle/scripts/*.ts`),
 * a test runner, `tsc`, `eslint`, `docker compose` or a recursive `pnpm -r` is
 * not something written here to be run over this tree, and whether CI runs those
 * is the `quality` and `test` stages' own subject rather than a gate inventory's.
 * A repository script file is what somebody wrote to be run, and it is the family
 * both defects live in: the 33 `check-*` scripts before this, and
 * `manifests:check` after them.
 *
 * ## How "a job runs it" is decided — derived, never written
 *
 * `pipelineCoverage` walks from the pipeline's own command lines to a fixpoint:
 * a job runs a script by name, that script runs another, and lifecycle hooks
 * (`pre*` / `post*`) come along. The pipeline's corpus includes the `RUN` lines
 * of every Dockerfile a `docker build -f <path>` command names, because three of
 * the gates are three hops down that path — `build:storefront` →
 * `storefront/Dockerfile` → `pnpm --filter storefront run build` →
 * `pnpm run check:themes`. A script the pipeline invokes by **file** rather than
 * by name (`quality`'s `tsx scripts/check-channel-resolution.ts --enforce`) is
 * covered too, and that half is confined to the pipeline's own text: two package
 * scripts routinely run one file in two modes, and letting a transitively
 * reached command contribute its file name would have reported
 * `manifests:generate` as covered because `manifests:check` is.
 *
 * ## The verdicts, and what makes one honest
 *
 * A script no job reaches needs an entry in {@link SCRIPTS_NO_JOB_RUNS}, and
 * each kind states a **property**, not a name:
 *
 *  - **`produces`** — its purpose is to write a file into the tree, so running
 *    it in CI would repair the drift instead of reporting it. It names the gate
 *    that verifies its output in `verifiedBy`, **and that gate must itself be
 *    reached by a job**. That single assertion is the whole defect: on `master`
 *    before this branch, `manifests:generate` wrote 70 manifests, named
 *    `manifests:check` as their verifier, and `manifests:check` ran nowhere.
 *    Derived half: the file it runs must actually contain a filesystem write.
 *  - **`superseded`** — a stronger form of the same rule runs in CI and this
 *    spelling exists for a human. Same requirement on the target.
 *  - **`developer-tool`** — it does work for a person on demand and has no
 *    verdict to give about the tree.
 *  - **`local-operation`** — the pipeline deliberately does not perform it.
 *
 * There is deliberately **no "not wired yet" verdict**. Every kind above says
 * either that the rule runs or that there is no rule; a gate whose rule runs
 * nowhere has no legal classification and fails here, which is the point. The
 * ledger is two-way in the estate's idiom: an entry naming a script that is gone
 * fails, and so does one for a script a job now runs.
 *
 * ## What this file does not answer
 *
 * *When* a job runs. `build:storefront` is `master`-only, so `check:themes` is
 * post-merge coverage; that is a second axis and would be a second rule. Nor
 * does it judge whether a rule is any good — that is
 * `check-inventory.test.ts`' red proofs, one population over.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

type VerdictKind = 'produces' | 'superseded' | 'developer-tool' | 'local-operation';

interface Verdict {
  readonly kind: VerdictKind;
  /**
   * For `produces` and `superseded`: the `member::script` that covers this
   * script's rule. It must be in the population and reached by a job.
   */
  readonly coveredBy?: string;
  /** Why this script is not a gate a pipeline should run. A property, never a name. */
  readonly reason: string;
}

/**
 * Every repository script no job reaches, and why that is right.
 *
 * Twelve entries. It held thirteen until the merge request that wrote this file
 * put `manifests:check` into `quality`.
 */
const SCRIPTS_NO_JOB_RUNS: Readonly<Record<string, Verdict>> = {
  'backend::acceptance:package-schema': {
    kind: 'superseded',
    coveredBy: 'backend::acceptance:package-schema:ci',
    reason:
      'The bare form exits on the acceptance criterion\'s own colour, which is a developer ' +
      'asking "is it met today". The `:ci` form asks the question a pipeline can hold a branch ' +
      'to — drift against the committed `backend/acceptance/expected-state.json`, in both ' +
      'directions — and that is the one `acceptance:package-schema` runs.',
  },
  'backend::acceptance:storefront-scaffold': {
    kind: 'superseded',
    coveredBy: 'backend::acceptance:storefront-scaffold:ci',
    reason:
      'The same pair one criterion over: the bare form reports the colour, the `:ci` form ' +
      'ratchets it against `backend/acceptance/storefront-scaffold-expected-state.json`, and ' +
      'the `acceptance:storefront-scaffold` job runs the second.',
  },
  'backend::composer:check': {
    kind: 'superseded',
    coveredBy: 'backend::overlay:check',
    reason:
      'It compares the seven committed composer artefacts to a fresh render. `overlay:check` ' +
      'renders the same seven plus the divergence reports and the per-module references, and ' +
      'adds the `foreign` containment verdict on top — every question this one asks, and three ' +
      'it does not.',
  },
  'backend::composer:generate': {
    kind: 'produces',
    coveredBy: 'backend::overlay:check',
    reason:
      'It writes the seven generated artefacts and copies the module-owned documentation pages ' +
      'into the site tree. A pipeline that ran it would repair the staleness it is meant to ' +
      'report and go green on a commit nobody can reproduce.',
  },
  'backend::manifest-index:generate': {
    kind: 'produces',
    coveredBy: 'backend::overlay:check',
    reason:
      'The same generator under its older name, kept for the module-index half of the work. It ' +
      'writes, for the same reason `composer:generate` does.',
  },
  'backend::manifests:generate': {
    kind: 'produces',
    coveredBy: 'backend::manifests:check',
    reason:
      "It renders every module package's `package.json` and the admin's dependency block from " +
      'the layer inventory. Running it in CI would rewrite the manifests the pipeline is ' +
      'supposed to be judging — and, since a generated manifest changes what a workspace ' +
      'declares, would leave `pnpm-lock.yaml` behind it.',
  },
  'backend::overlay:divergence': {
    kind: 'produces',
    coveredBy: 'backend::overlay:check',
    reason:
      "It writes each deployment's `divergence.generated.ts` and `.md`. Both renderings are " +
      "under `overlay:check`'s four verdicts, and `check:divergence` judges what they say.",
  },
  'backend::migration:new': {
    kind: 'developer-tool',
    reason:
      "It scaffolds a migration file into the owning module's `migrations/` directory on " +
      'demand, with a clamped UTC stamp and a derived class name. It answers no question about ' +
      'the tree; a pipeline running it would add a migration to the branch.',
  },
  'backend::dev': {
    kind: 'developer-tool',
    reason:
      'An esbuild watch over `backend/src` plus a restart loop. It never terminates and reports ' +
      'nothing.',
  },
  'backend::worker:dev': {
    kind: 'developer-tool',
    reason: 'The same watch loop over the worker entry point.',
  },
  '<root>::dev': {
    kind: 'developer-tool',
    reason: 'The full dev stack, across all three applications. It never terminates.',
  },
  '<root>::version:packages': {
    kind: 'local-operation',
    reason:
      'It cuts a `release/version-<date>` branch and consumes the pending changesets. It runs ' +
      "locally by design: a CI job that could open that merge request needs a push credential " +
      'D-160.5 defers to the merge request that makes a package public, and the reasoning is in ' +
      "the script's own header. What CI asks instead is the resulting branch's inverted " +
      'question, in `release:changeset`.',
  },
};

/** The workspace manifests, plus the repository root's, as the analysis reads them. */
function readMembers(): readonly ScriptMember[] {
  const members: ScriptMember[] = workspaceMembers(REPO_ROOT, nodeWorkspaceFs()).map((member) => ({
    name: member.name,
    dir: member.dir.slice(REPO_ROOT.length).replace(/\/$/, ''),
    scripts: (member.manifest['scripts'] ?? {}) as Readonly<Record<string, string>>,
  }));
  const root = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Readonly<Record<string, string>>;
  };
  members.push({ name: ROOT_MEMBER, dir: '', scripts: root.scripts ?? {} });
  return members;
}

const MEMBERS = readMembers();
const CANDIDATES = repositoryScripts(MEMBERS);
const JOBS = readJobs(readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8'));
const COVERAGE: Coverage = pipelineCoverage({
  commands: commandLines(JOBS),
  dockerfile: (path) => {
    try {
      return readFileSync(join(REPO_ROOT, path), 'utf8');
    } catch {
      return null;
    }
  },
  members: MEMBERS,
});

const UNREACHED = CANDIDATES.filter((candidate) => !COVERAGE.reached.has(candidate.key));

/**
 * The floors (issue #244).
 *
 * Everything below is "no script is unaccounted for", which is also what an
 * empty population says, what a pipeline parse that stopped recognising `script:`
 * says, and what a coverage derivation that credited everything says. Each of
 * these is one of those states, named.
 */
describe('the gate-coverage reconciliation read what it claims to read', () => {
  it('found the workspace members that declare scripts, the root among them', () => {
    const named = MEMBERS.map((member) => member.name);
    expect(named).toEqual(expect.arrayContaining([ROOT_MEMBER, 'backend', 'storefront']));
    expect(MEMBERS.length).toBeGreaterThanOrEqual(10);
  });

  it('derived a population of repository scripts', () => {
    expect(CANDIDATES.length).toBeGreaterThanOrEqual(30);
    const keys = CANDIDATES.map((candidate) => candidate.key);
    expect(keys).toContain('backend::manifests:check');
    expect(keys).toContain('backend::check:module-boundary');
    expect(keys).toContain('<root>::check:naming');
  });

  it('parsed a pipeline that looks like this one, and read the images it builds', () => {
    expect(JOBS.map((job) => job.name)).toEqual(
      expect.arrayContaining(['quality', 'quality:static', 'build:backend']),
    );
    expect(commandLines(JOBS).length).toBeGreaterThanOrEqual(100);
    expect(COVERAGE.dockerfilesRead.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Both coverage mechanisms still work. They are independent, and a run in
   * which one has silently stopped matching reports the other's population as
   * the whole answer — the #235/#237 shape, where the file count holds steady
   * while the classification goes blind.
   */
  it('reached scripts by name and scripts by file', () => {
    const byName = CANDIDATES.filter((candidate) => COVERAGE.byName.has(candidate.key));
    const byFile = CANDIDATES.filter((candidate) => COVERAGE.byFile.has(candidate.key));
    expect(byName.length).toBeGreaterThanOrEqual(20);
    expect(byFile.length).toBeGreaterThanOrEqual(2);
    expect(COVERAGE.reached.size).toBeGreaterThanOrEqual(30);
  });
});

describe('every gate this repository wrote is run by a job, or says why not', () => {
  it('leaves no repository script unaccounted for', () => {
    const unaccounted = UNREACHED.filter(
      (candidate) => SCRIPTS_NO_JOB_RUNS[candidate.key] === undefined,
    ).map((candidate) => `${candidate.where} → ${candidate.script} (${candidate.file})`);

    expect(
      unaccounted,
      `${unaccounted.join('; ')}: no CI job runs this script, and no entry in ` +
        'SCRIPTS_NO_JOB_RUNS says why that is right. A rule nobody runs is not a weaker gate ' +
        'than one that runs and is ignored — it is no gate at all, which is what ' +
        '`manifests:check` was for its whole existence while `AGENTS.md` cited it as the ' +
        'instrument that fails on drift. Either wire it into a job, or classify it with a ' +
        'property: it writes the tree, it is superseded by a stronger gate a job runs, it is a ' +
        'developer tool, or the pipeline deliberately does not perform it.',
    ).toEqual([]);
  });

  it('holds no entry for a script a job now runs', () => {
    const stale = Object.keys(SCRIPTS_NO_JOB_RUNS).filter((key) => COVERAGE.reached.has(key));
    expect(
      stale,
      `${stale.join(', ')}: a job runs this now, so the entry excusing it is stale. Delete it.`,
    ).toEqual([]);
  });

  it('holds no entry for a script that is gone', () => {
    const known = new Set(CANDIDATES.map((candidate) => candidate.key));
    const orphans = Object.keys(SCRIPTS_NO_JOB_RUNS).filter((key) => !known.has(key));
    expect(
      orphans,
      `${orphans.join(', ')}: no workspace script by that name runs a repository script file.`,
    ).toEqual([]);
  });

  it('gives every entry a reason', () => {
    const silent = Object.entries(SCRIPTS_NO_JOB_RUNS)
      .filter(([, verdict]) => verdict.reason.trim().length < 40)
      .map(([key]) => key);
    expect(silent).toEqual([]);
  });

  /**
   * The assertion the defect is made of.
   *
   * A generator whose output is committed owes somebody a verifier, and a
   * verifier no job runs is the same as none. `manifests:generate` named
   * `manifests:check`, `manifests:check` ran nowhere, and 70 manifests went
   * stale on `master` with nothing to say so.
   */
  it("runs the gate that covers every excused script's rule", () => {
    const known = new Set(CANDIDATES.map((candidate) => candidate.key));
    const broken: string[] = [];
    for (const [key, verdict] of Object.entries(SCRIPTS_NO_JOB_RUNS)) {
      if (verdict.kind !== 'produces' && verdict.kind !== 'superseded') continue;
      const target = verdict.coveredBy;
      if (target === undefined) {
        broken.push(`${key}: kind ${verdict.kind} with no coveredBy`);
        continue;
      }
      if (!known.has(target)) broken.push(`${key}: coveredBy ${target} is not a repository script`);
      else if (!COVERAGE.reached.has(target)) broken.push(`${key}: no job runs ${target}`);
    }
    expect(
      broken,
      `${broken.join('; ')}. A generator's output is committed, so something has to verify it ` +
        'and that something has to run. This is the assertion that was false on `master` ' +
        'before it existed.',
    ).toEqual([]);
  });

  it('has no coveredBy on a kind that claims no coverage', () => {
    const misplaced = Object.entries(SCRIPTS_NO_JOB_RUNS)
      .filter(
        ([, verdict]) =>
          verdict.coveredBy !== undefined &&
          verdict.kind !== 'produces' &&
          verdict.kind !== 'superseded',
      )
      .map(([key]) => key);
    expect(misplaced).toEqual([]);
  });

  /**
   * The derived half of `produces`. "It writes the tree" is the property the
   * verdict rests on, so it is measured rather than believed: a script
   * reclassified as a generator to make this file green fails here unless its
   * entry point genuinely writes.
   */
  it('finds a filesystem write in every script classified as a generator', () => {
    const writes = /\b(?:writeFileSync|appendFileSync|mkdirSync|cpSync|copyFileSync|renameSync|rmSync|writeFile)\b/;
    const notWriting: string[] = [];
    for (const [key, verdict] of Object.entries(SCRIPTS_NO_JOB_RUNS)) {
      if (verdict.kind !== 'produces') continue;
      const candidate = CANDIDATES.find((entry) => entry.key === key);
      if (candidate === undefined) continue;
      const member = MEMBERS.find((entry) => entry.name === candidate.member)!;
      const source = readFileSync(join(REPO_ROOT, member.dir, candidate.file), 'utf8');
      if (!writes.test(source)) notWriting.push(`${key} → ${candidate.file}`);
    }
    expect(
      notWriting,
      `${notWriting.join(', ')}: classified as a generator, and its entry point writes nothing.`,
    ).toEqual([]);
  });
});

/**
 * One red proof per shape this file refuses, each entering at the top of the
 * analysis — over invented manifests and an invented pipeline, never over a
 * value the analysis normally computes (issue #130).
 */
describe('the reconciliation can go red', () => {
  const pipelineOf = (...commands: readonly string[]): readonly string[] => commands;
  const noDockerfile = (): null => null;

  const gateMember: ScriptMember = {
    name: 'backend',
    dir: 'backend',
    scripts: {
      'thing:check': 'tsx scripts/generate-thing.ts --check',
      'thing:generate': 'tsx scripts/generate-thing.ts',
    },
  };

  it('reports a gate no job runs', () => {
    const coverage = pipelineCoverage({
      commands: pipelineOf('    - pnpm --filter backend run lint'),
      dockerfile: noDockerfile,
      members: [gateMember],
    });
    const unreached = repositoryScripts([gateMember]).filter(
      (candidate) => !coverage.reached.has(candidate.key),
    );
    expect(unreached.map((candidate) => candidate.key)).toEqual([
      'backend::thing:check',
      'backend::thing:generate',
    ]);
  });

  it('does not report a gate a job runs by name', () => {
    const coverage = pipelineCoverage({
      commands: pipelineOf('    - pnpm --filter backend run thing:check'),
      dockerfile: noDockerfile,
      members: [gateMember],
    });
    expect(coverage.reached.has(keyOf('backend', 'thing:check'))).toBe(true);
    // And the generator sharing its file is NOT credited: the file half is
    // confined to the pipeline's own text, which is what keeps the pair apart.
    expect(coverage.reached.has(keyOf('backend', 'thing:generate'))).toBe(false);
  });

  it('follows a job through a Dockerfile and a chain of package scripts', () => {
    const members: readonly ScriptMember[] = [
      {
        name: 'storefront',
        dir: 'storefront',
        scripts: {
          build: 'pnpm run themes:generate && next build && pnpm run check:themes',
          'themes:generate': 'node scripts/generate-themes.mjs',
          'check:themes': 'node scripts/check-themes.mjs',
        },
      },
      { name: ROOT_MEMBER, dir: '', scripts: {} },
    ];
    const coverage = pipelineCoverage({
      commands: pipelineOf('    - docker build -f storefront/Dockerfile -t x .'),
      dockerfile: (path) =>
        path === 'storefront/Dockerfile' ? 'RUN pnpm --filter storefront run build\n' : null,
      members,
    });
    expect(coverage.dockerfilesRead).toEqual(['storefront/Dockerfile']);
    expect(coverage.reached.has(keyOf('storefront', 'check:themes'))).toBe(true);
    expect(coverage.reached.has(keyOf('storefront', 'themes:generate'))).toBe(true);
  });

  it('follows a lifecycle hook, which no command names', () => {
    const member: ScriptMember = {
      name: 'storefront',
      dir: 'storefront',
      scripts: { build: 'next build', prebuild: 'node scripts/generate-themes.mjs' },
    };
    const coverage = pipelineCoverage({
      commands: pipelineOf('    - pnpm --filter storefront run build'),
      dockerfile: noDockerfile,
      members: [member],
    });
    expect(coverage.reached.has(keyOf('storefront', 'prebuild'))).toBe(true);
  });

  it('refuses a selector it cannot read rather than guessing at it', () => {
    const member: ScriptMember = { name: 'backend', dir: 'backend', scripts: {} };
    expect(selectorMatches('backend', member)).toBe(true);
    expect(selectorMatches('./backend', member)).toBe(true);
    expect(selectorMatches('./storefront', member)).toBe(false);
    expect(
      selectorMatches('"./packages/**"', { name: 'p', dir: 'packages/modules/x', scripts: {} }),
    ).toBe(true);
    expect(
      selectorMatches('"./packages/*"', { name: 'p', dir: 'packages/modules/x', scripts: {} }),
    ).toBe(false);
    // `backend^...` selects backend's dependencies, not backend.
    expect(selectorMatches('"backend^..."', member)).toBe(false);
  });

  it('reads a repository script out of a command, and nothing else out of one', () => {
    expect(repositoryScriptFile('tsx scripts/check-nul-bytes.ts')).toBe('scripts/check-nul-bytes.ts');
    expect(repositoryScriptFile('node --env-file-if-exists=.env scripts/dev.mjs')).toBe(
      'scripts/dev.mjs',
    );
    expect(repositoryScriptFile('tsc -p tsconfig.build.json && tsx scripts/copy.ts')).toBe(
      'scripts/copy.ts',
    );
    expect(repositoryScriptFile('node ../../scripts/copy-package-assets.mjs --src src')).toBe(
      '../../scripts/copy-package-assets.mjs',
    );
    // Application code that happens to sit under a directory called `scripts`.
    expect(
      repositoryScriptFile('tsx --env-file-if-exists=.env src/lifecycle/scripts/enable.ts'),
    ).toBeNull();
    expect(repositoryScriptFile('vitest run test/unit')).toBeNull();
  });

  it('reports a generator whose named verifier no job runs', () => {
    // The state `master` was in: the generator names its checker, and nothing
    // runs the checker.
    const coverage = pipelineCoverage({
      commands: pipelineOf('    - pnpm --filter backend run lint'),
      dockerfile: noDockerfile,
      members: [gateMember],
    });
    expect(coverage.reached.has(keyOf('backend', 'thing:check'))).toBe(false);
  });

  it('drops a comment line, so prose naming a script does not cover it', () => {
    const jobs = readJobs(
      ['quality:', '  script:', '    # runs pnpm --filter backend run thing:check one day', ''].join(
        '\n',
      ),
    );
    expect(commandLines(jobs)).toEqual([]);
    const coverage = pipelineCoverage({
      commands: commandLines(jobs),
      dockerfile: noDockerfile,
      members: [gateMember],
    });
    expect(coverage.reached.size).toBe(0);
  });
});
