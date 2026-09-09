import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  nodeWorkspaceFs,
  workspaceMembers,
  type WorkspaceFs,
} from '@endora-commerce/cli/lib/workspace-packages.js';
import { describe, expect, it } from 'vitest';

import { readCopy, readStages, type DockerInstruction, type DockerStage } from '../../helpers/dockerfile.js';

/**
 * An image that runs a workspace package's `build` supplies every
 * repository-root path those build scripts name.
 *
 * ## The defect
 *
 * `build:admin` of pipeline 13398 failed with
 *
 *     packages/platform build: Error: Cannot find module
 *     '/app/scripts/copy-package-assets.mjs'
 *
 * `@endora-commerce/platform`'s build is `tsc -p tsconfig.build.json && node
 * ../../scripts/copy-package-assets.mjs …`, and `admin/Dockerfile`'s build stage
 * copied `tsconfig.base.json`, `packages/` and `admin/` — not the
 * repository-root `scripts/` directory. `backend/Dockerfile` had copied it since
 * the day the first such package existed, with a comment saying exactly why: the
 * author repaired one Dockerfile and the other two were the same shape and were
 * not looked at.
 *
 * It had been latent for as long as the pipeline had been cancelling the job.
 * Build jobs sit last, behind the serialised `test:backend`, so every push
 * killed them; 13398 is the first pipeline in which `build:admin` ever ran.
 *
 * ## Why this is a third question and not either sibling's
 *
 * Both neighbours say so in their own headers, and both are right.
 * `dockerfile-workspace-supply.test.ts` states a containment between the two
 * halves of *this repository's workspace* — every member arriving with the
 * sources arrived with the manifests — and `scripts/` is a member of nothing, so
 * its absence is not a member's absence. `image-build-inputs.test.ts` asks what
 * the backend image's build *runs*, and the answer there is "no generator";
 * `copy-package-assets.mjs` is not a generator, it is the compile's second half,
 * and the image is supposed to run it.
 *
 * The question here is neither: **the image's build scope is a set of packages,
 * each of which names its own build inputs, and some of those inputs are outside
 * the package.** Nothing owned that.
 *
 * ## What is derived, and from what
 *
 * Nothing below is written down (D-100), because every part of it moved once
 * already and the movement is what produced the defect:
 *
 *   * the **Dockerfiles** come from `.gitlab-ci.yml`'s own `docker build -f`
 *     invocations, so a fourth image is judged by existing;
 *   * the **build scope** comes from the `pnpm --filter … run build` lines the
 *     Dockerfile itself runs, and the **closure** from the workspace manifests
 *     — measured against pnpm's own answer while this was written: 64 members
 *     for `admin^...`, 3 for `storefront^...`;
 *   * the **repository-root paths** come from each scope member's own `build`
 *     script — a relative specifier that escapes the package directory,
 *     resolved against the repository root — never from a literal
 *     `scripts/copy-package-assets.mjs`, which is one file today and is the
 *     kind of fact that has a second member tomorrow; and
 *   * the **supply** is the Dockerfile's own `COPY` set at the point the build
 *     runs, its ancestor stages included.
 *
 * ## Why this is a rule and not three `COPY` lines
 *
 * The obvious repair was `COPY scripts/ scripts/` in all three Dockerfiles, on
 * the ground that a closure moves and a line does not. Two thirds of it is what
 * the backend and the admin do. The storefront **cannot**, measured: its
 * `tsconfig.json` includes `test/**`, one of those tests imports
 * `../../scripts/tailwind-source-scan.ts`, and that file imports
 * `../backend/scripts/lib/workspace-packages.js` — which the storefront image
 * deliberately does not carry. With the line, `next build` fails on
 * `Cannot find module`; without it, the image builds. A preventive copy of a
 * directory an image can never hold is not a supply, and writing one is how a
 * defence becomes the next defect.
 *
 * That is the argument for a derivation rather than a convention. The
 * storefront's closure names no repository-root path today, so this rule asks
 * it for nothing; on the day one of its packages grows such a build step, the
 * run goes red naming the path, and the answer is a `COPY` of that path.
 *
 * ## Fail-closed, deliberately
 *
 * A `COPY --from=<stage>` supplies nothing here. It may in principle carry a
 * repository path, but what a stage kept is a second analysis, and the direction
 * to be wrong in is the one that reports a supply this file cannot read rather
 * than the one that credits it. Same for a destination that does not preserve
 * the repository's layout: `COPY scripts/ ./` puts the *contents* of `scripts/`
 * at `/app`, so `/app/scripts/copy-package-assets.mjs` is not there, and the
 * copy is not credited.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');

// --------------------------------------------------------------------------
// The workspace, read through the injected filesystem so a proof can hand in a
// whole synthetic checkout at the top of the analysis (issue #130).
// --------------------------------------------------------------------------

interface ScopeMember {
  readonly name: string;
  /** Repo-relative, `.` for the workspace root. */
  readonly directory: string;
  readonly buildScript: string | null;
  /** Names of the workspace members this one depends on. */
  readonly dependencies: readonly string[];
}

/**
 * Every member `pnpm` would see, plus the workspace root, which the globs never
 * match and which `pnpm -r` still selects.
 *
 * The dependency fields are the three pnpm's own filtering graph walks;
 * `peerDependencies` is deliberately not among them. Measured against
 * `pnpm --filter "admin^..." ls`, this derivation and pnpm agree exactly, with
 * and without peers — every module package that peers on a sibling also
 * dev-depends on it, because `manifests:generate` renders both.
 */
function scopeMembers(repoRoot: string, fs: WorkspaceFs): readonly ScopeMember[] {
  const members: ScopeMember[] = [];
  const rootManifest = fs.readText(posix.join(repoRoot, 'package.json'));
  const entries: { directory: string; manifest: Record<string, unknown> }[] = [];
  if (rootManifest !== null) {
    try {
      entries.push({ directory: '.', manifest: JSON.parse(rootManifest) as Record<string, unknown> });
    } catch {
      /* a root manifest that will not parse is not a member */
    }
  }
  for (const member of workspaceMembers(repoRoot, fs)) {
    const directory = member.dir === repoRoot ? '.' : member.dir.slice(repoRoot.length + 1);
    if (entries.some((entry) => entry.directory === directory)) continue;
    entries.push({ directory, manifest: member.manifest as Record<string, unknown> });
  }

  const names = new Set(
    entries.map((entry) => entry.manifest['name']).filter((name): name is string => typeof name === 'string'),
  );
  for (const entry of entries) {
    const name = entry.manifest['name'];
    if (typeof name !== 'string' || name === '') continue;
    const scripts = entry.manifest['scripts'];
    const build =
      typeof scripts === 'object' && scripts !== null
        ? (scripts as Record<string, unknown>)['build']
        : undefined;
    const dependencies = new Set<string>();
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      const declared = entry.manifest[field];
      if (typeof declared !== 'object' || declared === null) continue;
      for (const dependency of Object.keys(declared as Record<string, unknown>)) {
        if (names.has(dependency) && dependency !== name) dependencies.add(dependency);
      }
    }
    members.push({
      name,
      directory: entry.directory,
      buildScript: typeof build === 'string' ? build : null,
      dependencies: [...dependencies].sort(),
    });
  }
  return members;
}

/** The workspace-dependency closure of `name`, itself excluded. */
function dependencyClosure(name: string, members: readonly ScopeMember[]): readonly string[] {
  const byName = new Map(members.map((member) => [member.name, member]));
  const seen = new Set<string>();
  const queue = [...(byName.get(name)?.dependencies ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(byName.get(current)?.dependencies ?? []));
  }
  seen.delete(name);
  return [...seen].sort();
}

// --------------------------------------------------------------------------
// What a build script asks of the repository root
// --------------------------------------------------------------------------

/** One repository-root path a package's `build` script names. */
interface RootPathRequirement {
  readonly member: string;
  readonly directory: string;
  /** The specifier as written, e.g. `../../scripts/copy-package-assets.mjs`. */
  readonly specifier: string;
  /** Repo-relative, e.g. `scripts/copy-package-assets.mjs`. */
  readonly path: string;
}

/**
 * The paths in `buildScript` that escape `directory`.
 *
 * pnpm runs a script with the package directory as its working directory, so a
 * bare `scripts/x.ts` is the package's own and only a `../` prefix leaves it. A
 * specifier that escapes the *repository* as well is somebody else's problem and
 * is skipped — no `COPY` in this repository could supply it.
 */
function rootPathRequirements(member: ScopeMember): readonly RootPathRequirement[] {
  if (member.buildScript === null) return [];
  const found = new Map<string, RootPathRequirement>();
  for (const match of member.buildScript.matchAll(/(?:^|[\s='":])((?:\.\.\/)+[^\s'";|&]+)/g)) {
    const specifier = match[1]!;
    const base = member.directory === '.' ? '' : member.directory;
    const resolved = posix.normalize(posix.join(base, specifier));
    if (resolved.startsWith('..')) continue;
    if (base !== '' && (resolved === base || resolved.startsWith(`${base}/`))) continue;
    found.set(resolved, { member: member.name, directory: member.directory, specifier, path: resolved });
  }
  return [...found.values()].sort((left, right) => left.path.localeCompare(right.path));
}

// --------------------------------------------------------------------------
// The build steps a Dockerfile runs, and what has arrived by then
// --------------------------------------------------------------------------

/** A `pnpm … run build` invocation inside one `RUN`, and the selector it filters by. */
interface BuildInvocation {
  /** `null` when the command runs a build under a scope this file cannot read. */
  readonly selector: string | null;
  readonly command: string;
}

function buildInvocations(instruction: DockerInstruction): readonly BuildInvocation[] {
  if (instruction.keyword !== 'RUN') return [];
  const invocations: BuildInvocation[] = [];
  for (const command of instruction.rest.split(/&&|\|\||;|\|/)) {
    if (!/\bpnpm\b/.test(command)) continue;
    if (!/\brun\s+build\b/.test(command)) continue;
    const filter = /--filter[=\s]+"?([^"\s]+)"?/.exec(command);
    if (filter !== null) {
      invocations.push({ selector: filter[1]!, command: command.trim() });
      continue;
    }
    if (/\s(-r|--recursive)\b/.test(command)) {
      invocations.push({ selector: '-r', command: command.trim() });
      continue;
    }
    invocations.push({ selector: null, command: command.trim() });
  }
  return invocations;
}

type ScopeResolution =
  | { readonly kind: 'resolved'; readonly members: readonly ScopeMember[] }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unknown-member'; readonly name: string };

/**
 * `<name>`, `<name>...` and `<name>^...`, which is every shape this repository's
 * Dockerfiles write, plus `-r`. Anything richer — a path filter, a glob, a
 * `[<since>]` range, a leading `...` — is **unreadable** rather than empty: a
 * scope this file cannot resolve agrees with every rule.
 */
function resolveScope(selector: string | null, members: readonly ScopeMember[]): ScopeResolution {
  if (selector === null) return { kind: 'unreadable' };
  if (selector === '-r') return { kind: 'resolved', members };
  const suffix = /(\^\.\.\.|\.\.\.)$/.exec(selector);
  const base = suffix === null ? selector : selector.slice(0, -suffix[1]!.length);
  if (base === '' || /[!*{}[\]]/.test(base) || base.startsWith('.') || base.endsWith('/')) {
    return { kind: 'unreadable' };
  }
  const named = members.find((member) => member.name === base);
  if (named === undefined) return { kind: 'unknown-member', name: base };
  const byName = new Map(members.map((member) => [member.name, member]));
  const closure = dependencyClosure(base, members)
    .map((name) => byName.get(name))
    .filter((member): member is ScopeMember => member !== undefined);
  if (suffix === null) return { kind: 'resolved', members: [named] };
  if (suffix[1] === '^...') return { kind: 'resolved', members: closure };
  return { kind: 'resolved', members: [named, ...closure] };
}

/**
 * Every instruction that has run by the time `stage`'s instruction `index`
 * executes — its ancestors' in full, then its own up to that point.
 */
function instructionsBefore(
  stage: DockerStage,
  index: number,
  byName: ReadonlyMap<string, DockerStage>,
): readonly DockerInstruction[] {
  const ancestors: DockerInstruction[] = [];
  const seen = new Set<string>();
  let cursor = stage.base;
  while (cursor !== null && byName.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = byName.get(cursor)!;
    ancestors.unshift(...parent.instructions);
    cursor = parent.base;
  }
  return [...ancestors, ...stage.instructions.slice(0, index)];
}

const normalisePath = (path: string): string => {
  const trimmed = path.replace(/\/+$/, '').replace(/^\.\//, '');
  return trimmed === '' ? '.' : trimmed;
};

/**
 * Does this `COPY` put the repository's `path` at the matching place in the
 * image?
 *
 * Two shapes count and no third. A layout-preserving copy — destination equal to
 * source — covers the source and everything under it. A copy of a root-level
 * *file* into the working directory covers that file and nothing under it, which
 * is what keeps `COPY scripts/ ./` from being credited with
 * `scripts/copy-package-assets.mjs`: docker copies a directory's contents, so
 * that file lands at `/app/copy-package-assets.mjs` and the build's
 * `../../scripts/…` finds nothing.
 */
function copySupplies(instruction: DockerInstruction, path: string): boolean {
  const copy = readCopy(instruction);
  if (copy === null || copy.fromStage !== null || copy.destination === null) return false;
  const destination = normalisePath(copy.destination);
  return copy.sources.some((rawSource) => {
    const source = normalisePath(rawSource);
    if (destination === source) {
      return source === '.' || path === source || path.startsWith(`${source}/`);
    }
    if (destination === '.' && !source.includes('/')) return path === source;
    return false;
  });
}

// --------------------------------------------------------------------------
// The analysis
// --------------------------------------------------------------------------

type FindingKind = 'unsupplied-root-path' | 'unreadable-build-scope' | 'unknown-scope-member';

interface Finding {
  readonly dockerfile: string;
  readonly kind: FindingKind;
  readonly detail: string;
}

interface BuildStep {
  readonly dockerfile: string;
  readonly selector: string | null;
  readonly scope: readonly string[];
  readonly requirements: readonly RootPathRequirement[];
}

interface Estate {
  readonly dockerfiles: readonly string[];
  readonly members: readonly ScopeMember[];
  readonly steps: readonly BuildStep[];
  readonly findings: readonly Finding[];
}

/** The Dockerfiles CI builds, from its own `docker build -f` invocations. */
function builtDockerfiles(ciSource: string): readonly string[] {
  const found = new Set<string>();
  for (const match of ciSource.matchAll(/docker build\s+-f\s+(\S+)/g)) found.add(match[1]!);
  return [...found].sort();
}

function analyseImage(
  dockerfile: string,
  source: string,
  members: readonly ScopeMember[],
): { readonly steps: readonly BuildStep[]; readonly findings: readonly Finding[] } {
  const stages = readStages(source);
  const byName = new Map(
    stages.filter((stage) => stage.name !== null).map((stage) => [stage.name!, stage]),
  );
  const steps: BuildStep[] = [];
  const findings: Finding[] = [];

  for (const stage of stages) {
    for (const [index, instruction] of stage.instructions.entries()) {
      for (const invocation of buildInvocations(instruction)) {
        const resolution = resolveScope(invocation.selector, members);
        if (resolution.kind === 'unreadable') {
          findings.push({
            dockerfile,
            kind: 'unreadable-build-scope',
            detail:
              `\`${invocation.command}\` builds workspace packages under a filter this test ` +
              'cannot resolve, so which packages it builds — and therefore which repository-root ' +
              'paths they need — is unknown here. An unreadable scope agrees with every rule.',
          });
          continue;
        }
        if (resolution.kind === 'unknown-member') {
          findings.push({
            dockerfile,
            kind: 'unknown-scope-member',
            detail:
              `\`${invocation.command}\` filters on \`${resolution.name}\`, which is not a ` +
              'workspace member. pnpm selects nothing and the build step is a no-op.',
          });
          continue;
        }

        const requirements = resolution.members.flatMap(rootPathRequirements);
        steps.push({
          dockerfile,
          selector: invocation.selector,
          scope: resolution.members.map((member) => member.name),
          requirements,
        });

        const arrived = instructionsBefore(stage, index, byName);
        for (const requirement of requirements) {
          if (arrived.some((earlier) => copySupplies(earlier, requirement.path))) continue;
          findings.push({
            dockerfile,
            kind: 'unsupplied-root-path',
            detail:
              `${requirement.member} builds with \`${requirement.specifier}\`, which is ` +
              `${requirement.path} in this repository, and nothing has copied it into the image ` +
              `by the time \`${invocation.command}\` runs. The build dies on ` +
              `\`Cannot find module\`, and only a job that builds the image sees it.`,
          });
        }
      }
    }
  }
  return { steps, findings };
}

function analyseEstate(repoRoot: string, fs: WorkspaceFs): Estate {
  const ciSource = fs.readText(posix.join(repoRoot, '.gitlab-ci.yml')) ?? '';
  const dockerfiles = builtDockerfiles(ciSource);
  const members = scopeMembers(repoRoot, fs);
  const steps: BuildStep[] = [];
  const findings: Finding[] = [];
  for (const dockerfile of dockerfiles) {
    const source = fs.readText(posix.join(repoRoot, dockerfile));
    if (source === null) continue;
    const result = analyseImage(dockerfile, source, members);
    steps.push(...result.steps);
    findings.push(...result.findings);
  }
  return { dockerfiles, members, steps, findings };
}

// --------------------------------------------------------------------------
// 1. The rule, over this repository
// --------------------------------------------------------------------------

const ESTATE = analyseEstate(REPO_ROOT, nodeWorkspaceFs());

describe('every image supplies the repository-root paths its build scope names', () => {
  /**
   * The floors (issue #113). Everything below says "no image is missing a
   * repository-root path", and so does an empty Dockerfile list, an empty
   * workspace, a `RUN` reader that stopped recognising `pnpm --filter`, and a
   * scope in which no package names such a path at all. The last of those is the
   * load-bearing one: it is the state in which the rule is satisfied by nobody.
   */
  it('read a population that looks like this repository', () => {
    expect(ESTATE.dockerfiles).toEqual(
      expect.arrayContaining(['admin/Dockerfile', 'backend/Dockerfile', 'storefront/Dockerfile']),
    );
    expect(ESTATE.members.length, 'derived no workspace member').toBeGreaterThanOrEqual(8);

    for (const dockerfile of ESTATE.dockerfiles) {
      const stages = readStages(readFileSync(`${REPO_ROOT}/${dockerfile}`, 'utf8'));
      const keywords = stages.flatMap((stage) => stage.instructions.map((one) => one.keyword));
      expect(stages.length, `${dockerfile}: parsed no stage`).toBeGreaterThanOrEqual(1);
      expect(keywords, `${dockerfile}: parsed no COPY`).toContain('COPY');
      expect(keywords, `${dockerfile}: parsed no RUN`).toContain('RUN');
      expect(
        ESTATE.steps.some((step) => step.dockerfile === dockerfile),
        `${dockerfile}: no \`pnpm --filter … run build\` was read out of it`,
      ).toBe(true);
    }

    // Every step resolved to a scope, and a scope wider than one member exists —
    // a closure that collapsed to the filtered package would hide the defect,
    // which came from a package the filter never names.
    for (const step of ESTATE.steps) {
      expect(step.scope.length, `${step.dockerfile}: \`${step.selector}\` selected nothing`).toBeGreaterThan(0);
    }
    expect(ESTATE.steps.some((step) => step.scope.length > 1)).toBe(true);

    // The load-bearing floor: at least one package in at least one image's build
    // scope really does name a path outside itself. Without it the assertion
    // below is a claim about nothing.
    const requirements = ESTATE.steps.flatMap((step) => step.requirements);
    expect(
      requirements.map((requirement) => `${requirement.member} -> ${requirement.path}`),
      'No package in any image build scope names a repository-root path. Either the shape has ' +
        'gone (in which case this rule and the `COPY scripts/` lines are dead and should be ' +
        'retired together, deliberately) or the reader stopped seeing it.',
    ).not.toEqual([]);
  });

  it('copies every repository-root path a build in its scope names', () => {
    expect(
      ESTATE.findings.map((finding) => `${finding.dockerfile} [${finding.kind}] ${finding.detail}`),
      'Add the missing `COPY <path>` to the Dockerfile stage that runs the build, above the ' +
        '`RUN pnpm --filter … run build` line. `backend/Dockerfile` carries the worked example.',
    ).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// 2. The analysis bites — one proof per finding, over a synthetic checkout
// --------------------------------------------------------------------------

const FIXTURE_ROOT = '/repo';

/** A whole checkout, entering at the top of the analysis (issue #130). */
function fixtureFs(files: Readonly<Record<string, string>>): WorkspaceFs {
  const relative = (path: string): string | null => {
    if (path === FIXTURE_ROOT) return '';
    return path.startsWith(`${FIXTURE_ROOT}/`) ? path.slice(FIXTURE_ROOT.length + 1) : null;
  };
  return {
    readText(path: string): string | null {
      const key = relative(path);
      return key === null ? null : (files[key] ?? null);
    },
    listDirectories(path: string): readonly string[] {
      const key = relative(path);
      if (key === null) return [];
      const prefix = key === '' ? '' : `${key}/`;
      const names = new Set<string>();
      for (const candidate of Object.keys(files)) {
        if (!candidate.startsWith(prefix)) continue;
        const rest = candidate.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash > 0) names.add(rest.slice(0, slash));
      }
      return [...names];
    },
  };
}

const FIXTURE_CI = '  script:\n    - docker build -f admin/Dockerfile -t admin .\n';

/**
 * `admin/Dockerfile` as it stood at 819832c70, reduced to the instructions that
 * matter, over a workspace holding the package whose build broke it.
 */
const UNREPAIRED = [
  'FROM node:22.17-slim AS base',
  'WORKDIR /app',
  'FROM base AS build',
  'COPY tsconfig.base.json tsconfig.base.json',
  'RUN pnpm install --frozen-lockfile --filter admin...',
  'COPY packages/ packages/',
  'COPY admin/ admin/',
  'RUN pnpm --filter "admin^..." run build',
  'RUN pnpm --filter admin run build',
  '',
].join('\n');

function checkout(overrides: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  return {
    'pnpm-workspace.yaml': 'packages:\n  - admin\n  - packages/*\n  - packages/modules/*\n',
    'package.json': JSON.stringify({ name: 'root', scripts: { build: 'pnpm -r run build' } }),
    '.gitlab-ci.yml': FIXTURE_CI,
    'admin/Dockerfile': UNREPAIRED,
    'admin/package.json': JSON.stringify({
      name: 'admin',
      scripts: { build: 'vite build' },
      dependencies: { '@endora-commerce/mod-feeds': 'workspace:*' },
    }),
    'packages/modules/feeds/package.json': JSON.stringify({
      name: '@endora-commerce/mod-feeds',
      scripts: {
        build: 'tsc -p tsconfig.build.json && node ../../../scripts/copy-package-assets.mjs --src src --out dist',
      },
      devDependencies: { '@endora-commerce/contracts': 'workspace:*' },
    }),
    'packages/contracts/package.json': JSON.stringify({
      name: '@endora-commerce/contracts',
      scripts: { build: 'tsc -p tsconfig.build.json' },
    }),
    ...overrides,
  };
}

const analyseFixture = (files: Readonly<Record<string, string>>): Estate =>
  analyseEstate(FIXTURE_ROOT, fixtureFs(files));

describe('the supply is decided by reading the file, not by trusting its shape', () => {
  it('names the path, the package that needs it and the step that dies without it', () => {
    const estate = analyseFixture(checkout());
    expect(estate.findings.map((finding) => finding.kind)).toEqual(['unsupplied-root-path']);
    expect(estate.findings[0]?.detail).toContain('scripts/copy-package-assets.mjs');
    // The package is reached through the closure, not named by the filter: that
    // is the whole reason a Dockerfile can be wrong without being edited.
    expect(estate.findings[0]?.detail).toContain('@endora-commerce/mod-feeds');
    expect(estate.steps[0]?.scope).toEqual([
      '@endora-commerce/contracts',
      '@endora-commerce/mod-feeds',
    ]);
  });

  it('accepts the repair', () => {
    const estate = analyseFixture(
      checkout({
        'admin/Dockerfile': UNREPAIRED.replace(
          'COPY admin/ admin/',
          'COPY admin/ admin/\nCOPY scripts/ scripts/',
        ),
      }),
    );
    expect(estate.findings).toEqual([]);
    expect(estate.steps.flatMap((step) => step.requirements).map((one) => one.path)).toEqual([
      'scripts/copy-package-assets.mjs',
    ]);
  });

  it('accepts a copy an ancestor stage made', () => {
    const estate = analyseFixture(
      checkout({
        'admin/Dockerfile': UNREPAIRED.replace(
          'WORKDIR /app',
          'WORKDIR /app\nCOPY scripts/ scripts/',
        ),
      }),
    );
    expect(estate.findings).toEqual([]);
  });

  it('refuses a copy that does not preserve the repository layout', () => {
    // `COPY scripts/ ./` puts the directory's *contents* at /app, so
    // /app/scripts/copy-package-assets.mjs is not there.
    const estate = analyseFixture(
      checkout({
        'admin/Dockerfile': UNREPAIRED.replace('COPY admin/ admin/', 'COPY admin/ admin/\nCOPY scripts/ ./'),
      }),
    );
    expect(estate.findings.map((finding) => finding.kind)).toEqual(['unsupplied-root-path']);
  });

  it('refuses a copy that arrives after the build has run', () => {
    const estate = analyseFixture(
      checkout({
        'admin/Dockerfile': UNREPAIRED.replace(
          'RUN pnpm --filter admin run build',
          'COPY scripts/ scripts/\nRUN pnpm --filter admin run build',
        ),
      }),
    );
    expect(estate.findings.map((finding) => finding.kind)).toEqual(['unsupplied-root-path']);
  });

  it('does not credit a supply it cannot read', () => {
    const estate = analyseFixture(
      checkout({
        'admin/Dockerfile': UNREPAIRED.replace(
          'COPY admin/ admin/',
          'COPY admin/ admin/\nCOPY --from=manifests /manifests/scripts/ scripts/',
        ),
      }),
    );
    expect(estate.findings.map((finding) => finding.kind)).toEqual(['unsupplied-root-path']);
  });

  it('excludes the filtered package itself from a `^...` scope', () => {
    // If `^...` were read as `...`, admin's own build script would join the
    // scope — and a repository-root path it named would be demanded of a step
    // that never builds it.
    const estate = analyseFixture(
      checkout({
        'admin/Dockerfile': [
          'FROM node:22.17-slim AS build',
          'COPY packages/ packages/',
          'RUN pnpm --filter "admin^..." run build',
          '',
        ].join('\n'),
        'admin/package.json': JSON.stringify({
          name: 'admin',
          scripts: { build: 'node ../scripts/only-admin-needs-this.mjs && vite build' },
          dependencies: { '@endora-commerce/contracts': 'workspace:*' },
        }),
      }),
    );
    expect(estate.steps[0]?.scope).toEqual(['@endora-commerce/contracts']);
    expect(estate.findings).toEqual([]);
  });

  it('reports a build scope it cannot resolve rather than passing it', () => {
    const unreadable = analyseFixture(
      checkout({
        'admin/Dockerfile': UNREPAIRED.replace(
          'RUN pnpm --filter "admin^..." run build',
          'RUN pnpm --filter "...[origin/master]" run build',
        ),
      }),
    );
    expect(unreadable.findings.map((finding) => finding.kind)).toContain('unreadable-build-scope');

    const unfiltered = analyseFixture(
      checkout({ 'admin/Dockerfile': 'FROM node AS build\nCOPY admin/ admin/\nRUN pnpm run build\n' }),
    );
    expect(unfiltered.findings.map((finding) => finding.kind)).toEqual(['unreadable-build-scope']);
  });

  it('reports a filter naming no workspace member', () => {
    const estate = analyseFixture(
      checkout({
        'admin/Dockerfile': UNREPAIRED.replace('"admin^..."', '"adnim^..."'),
      }),
    );
    expect(estate.findings.map((finding) => finding.kind)).toContain('unknown-scope-member');
  });

  it('leaves a specifier that escapes the repository to somebody else', () => {
    const estate = analyseFixture(
      checkout({
        'packages/contracts/package.json': JSON.stringify({
          name: '@endora-commerce/contracts',
          scripts: { build: 'node ../../../../elsewhere/tool.mjs' },
        }),
      }),
    );
    expect(estate.steps.flatMap((step) => step.requirements).map((one) => one.path)).toEqual([
      'scripts/copy-package-assets.mjs',
    ]);
  });

  it('produces no requirement where no build script escapes its package — which is what the floor refuses', () => {
    const estate = analyseFixture(
      checkout({
        'packages/modules/feeds/package.json': JSON.stringify({
          name: '@endora-commerce/mod-feeds',
          scripts: { build: 'tsc -p tsconfig.build.json && node scripts/copy-package-assets.mjs' },
          devDependencies: { '@endora-commerce/contracts': 'workspace:*' },
        }),
      }),
    );
    expect(estate.findings).toEqual([]);
    // Green, and about nothing: the floor above is the only thing between that
    // state and a rule everybody believes is running.
    expect(estate.steps.flatMap((step) => step.requirements)).toEqual([]);
  });
});
