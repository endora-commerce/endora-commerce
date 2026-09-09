import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readCopy, readStages, type DockerStage } from '../../helpers/dockerfile.js';

/**
 * Every workspace member an image builds was a member when that image installed.
 *
 * `build:backend` of pipeline 11488 failed with
 * `Property 'addSql' does not exist on type 'Migration20260506T081055BlogInit'`,
 * forty lines into a migration that had compiled for months. Nothing was wrong
 * with the migration: `backend/Dockerfile` copied seven package manifests **by
 * name** before `pnpm install`, and `packages/modules/blog` — a workspace member
 * since !910 — was not among the seven. So at install time `blog` was not a
 * member, received no `node_modules`, and its `@mikro-orm/migrations` *peer*
 * dependency resolved to nothing; the `COPY packages/` two lines later then put
 * its sources into the image anyway, and `pnpm --filter "backend^..." run build`
 * compiled a package whose base class had no types.
 *
 * That list is a hand-kept copy of a derived fact — which directories are
 * workspace members, stated once in `pnpm-workspace.yaml` — and D-100 refuses
 * the shape. It had already drifted twice (`packages/platform` added by hand,
 * `packages/modules/blog` missed) and 63 more module packages are coming, so an
 * eighth `COPY` line would buy one merge request and schedule the same failure
 * for each of the rest. The Dockerfiles now derive the set, through
 * `scripts/collect-workspace-manifests.sh`.
 *
 * This file is the rule rather than the repair, and it is stated as a
 * containment: **whatever member arrives with the sources must have arrived with
 * the manifests**. That is exactly the defect — `blog` arrived once, in the half
 * where its absence was invisible — and it says nothing about a member no image
 * touches, so a `.dockerignore` entry (`docs`) removes a member from both sides
 * at once rather than needing an exception here.
 *
 * There are two halves, because the structural half alone would only check that
 * the Dockerfile *asks* for a derivation:
 *
 *  1. every Dockerfile CI builds satisfies the containment (below), and
 *  2. the derivation it delegates to really does enumerate every member,
 *     including one nested a directory deeper than any that exists today —
 *     asserted by running the script, not by reading it.
 *
 * The Dockerfile reader itself is `test/helpers/dockerfile.ts`. It lived here
 * until `image-root-script-supply.test.ts` became its second reader; two parsers
 * over one file would be one population derived twice.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const COLLECTOR = join(REPO_ROOT, 'scripts/collect-workspace-manifests.sh');

// --------------------------------------------------------------------------
// The workspace members, derived here from `pnpm-workspace.yaml`
// --------------------------------------------------------------------------

/**
 * Deliberately not `pnpm ls`, and deliberately not the collector script: this
 * side of the test has to be an *independent* derivation of the same answer, or
 * a collector that enumerates nothing would agree with a Dockerfile that
 * supplies nothing and the pair would report a cheerful green.
 *
 * Not a YAML parser either — this repository has no YAML dependency and
 * Constitution IV says the default answer to a new one is no. The file is a
 * flat sequence of `  - <glob>` entries; a flow-style list would produce no
 * globs, which the floor below refuses.
 */
function workspaceGlobs(source: string): readonly string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of source.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (line !== '' && !/^\s/.test(line)) inPackages = false;
    if (!inPackages) continue;
    const entry = /^\s+-\s+["']?([^"'\s#]+)["']?\s*$/.exec(line);
    if (entry !== null) globs.push(entry[1]!);
  }
  return globs;
}

/** Expand one workspace glob to the directories it names. Only `*` occurs. */
function expandGlob(glob: string): readonly string[] {
  let candidates = [''];
  for (const segment of glob.split('/')) {
    const next: string[] = [];
    for (const candidate of candidates) {
      const absolute = join(REPO_ROOT, candidate);
      if (segment === '*') {
        if (!existsSync(absolute)) continue;
        for (const entry of readdirSync(absolute, { withFileTypes: true })) {
          if (entry.isDirectory()) next.push(candidate === '' ? entry.name : `${candidate}/${entry.name}`);
        }
      } else {
        next.push(candidate === '' ? segment : `${candidate}/${segment}`);
      }
    }
    candidates = next;
  }
  return candidates;
}

/** Member directories, repo-relative; the workspace root is `.`. */
function workspaceMembers(): readonly string[] {
  const globs = workspaceGlobs(readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8'));
  const members = new Set<string>(['.']);
  for (const glob of globs) {
    for (const directory of expandGlob(glob)) {
      if (existsSync(join(REPO_ROOT, directory, 'package.json'))) members.add(directory);
    }
  }
  return [...members].sort();
}

const MEMBERS = workspaceMembers();

// --------------------------------------------------------------------------
// The Dockerfiles, derived from the CI file that builds them
// --------------------------------------------------------------------------

const CI_SOURCE = readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');

function builtDockerfiles(source: string): readonly string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/docker build\s+-f\s+(\S+)/g)) found.add(match[1]!);
  return [...found].sort();
}

const DOCKERFILES = builtDockerfiles(CI_SOURCE);

// --------------------------------------------------------------------------
// Reading a Dockerfile
// --------------------------------------------------------------------------

/** `packages/contracts/package.json` → `packages/contracts`; `package.json` → `.`. */
function memberOfManifestPath(path: string): string | null {
  if (!path.endsWith('package.json')) return null;
  const directory = path.slice(0, -'package.json'.length).replace(/\/$/, '');
  return directory === '' ? '.' : directory;
}

/**
 * Does this stage hand on *every* member's manifest?
 *
 * Only one shape counts, and it is a shape rather than a stage name: the stage
 * takes the whole build context (`COPY . …`, no path selecting a subtree) and
 * runs the collector over it. A stage that copies a chosen subtree, or that
 * builds its output some other way, is not credited — it is reported as
 * unreadable, because a supply this test cannot read agrees with everything.
 */
function derivesEveryManifest(stage: DockerStage): boolean {
  const copiesWholeContext = stage.instructions.some((instruction) => {
    const copy = readCopy(instruction);
    return copy !== null && copy.fromStage === null && copy.sources.length === 1 && copy.sources[0] === '.';
  });
  const runsCollector = stage.instructions.some(
    (instruction) =>
      instruction.keyword === 'RUN' && instruction.rest.includes('collect-workspace-manifests.sh'),
  );
  return copiesWholeContext && runsCollector;
}

interface Finding {
  readonly dockerfile: string;
  readonly kind: 'unsupplied-member' | 'unreadable-supply' | 'no-install';
  readonly detail: string;
}

/**
 * The containment, per Dockerfile.
 *
 * `pnpm install` splits the file: what stands above it is the workspace the
 * install sees, what stands below it is the workspace the build sees. A member
 * whose sources arrive below and whose manifest never arrived above is a member
 * with no `node_modules`, which is the defect.
 */
function analyse(dockerfile: string, source: string, members: readonly string[]): readonly Finding[] {
  const stages = readStages(source);
  const byName = new Map(stages.filter((stage) => stage.name !== null).map((stage) => [stage.name!, stage]));

  const installStage = stages.find((stage) =>
    stage.instructions.some(
      (instruction) => instruction.keyword === 'RUN' && /\bpnpm install\b/.test(instruction.rest),
    ),
  );
  if (installStage === undefined) {
    return [{ dockerfile, kind: 'no-install', detail: 'no `RUN pnpm install` in any stage' }];
  }
  const installIndex = installStage.instructions.findIndex(
    (instruction) => instruction.keyword === 'RUN' && /\bpnpm install\b/.test(instruction.rest),
  );

  const findings: Finding[] = [];
  const supplied = new Set<string>();
  for (const instruction of installStage.instructions.slice(0, installIndex)) {
    const copy = readCopy(instruction);
    if (copy === null) continue;
    if (copy.fromStage !== null) {
      const source = byName.get(copy.fromStage);
      if (source !== undefined && derivesEveryManifest(source)) {
        for (const member of members) supplied.add(member);
        continue;
      }
      findings.push({
        dockerfile,
        kind: 'unreadable-supply',
        detail:
          `COPY --from=${copy.fromStage} before the install, and that stage neither takes the whole ` +
          'build context nor runs scripts/collect-workspace-manifests.sh. What it supplies cannot be ' +
          'read here, and an unreadable supply agrees with every rule.',
      });
      continue;
    }
    for (const path of copy.sources) {
      const member = memberOfManifestPath(path);
      if (member !== null) supplied.add(member);
    }
  }

  const arriving = new Set<string>();
  for (const instruction of installStage.instructions.slice(installIndex + 1)) {
    const copy = readCopy(instruction);
    if (copy === null || copy.fromStage !== null) continue;
    for (const path of copy.sources) {
      const prefix = path.replace(/\/$/, '');
      for (const member of members) {
        if (prefix === '.' || member === prefix || member.startsWith(`${prefix}/`)) arriving.add(member);
      }
    }
  }

  for (const member of [...arriving].sort()) {
    if (supplied.has(member)) continue;
    findings.push({
      dockerfile,
      kind: 'unsupplied-member',
      detail:
        `${member} is a workspace member whose sources this image copies, and whose package.json ` +
        'never reached the image before `pnpm install`. It therefore gets no node_modules, and ' +
        'whatever it compiles fails on a dependency the install was never asked to fetch.',
    });
  }
  return findings;
}

// --------------------------------------------------------------------------
// 1. The rule, over this repository
// --------------------------------------------------------------------------

describe('every image installs every workspace member it later builds', () => {
  /**
   * The floor (issue #244). Everything below says "no Dockerfile violates the
   * containment", which is also what an empty Dockerfile list, an empty member
   * list and a parser that stopped recognising `COPY` all say.
   */
  it('read a population that looks like this repository', () => {
    expect(DOCKERFILES).toEqual(
      expect.arrayContaining(['admin/Dockerfile', 'backend/Dockerfile', 'storefront/Dockerfile']),
    );
    expect(MEMBERS).toEqual(expect.arrayContaining(['.', 'backend', 'packages/contracts']));
    expect(MEMBERS.length).toBeGreaterThanOrEqual(8);
    // A member two directories deep, which is what the drift missed and what a
    // one-level derivation would silently drop.
    expect(MEMBERS.some((member) => member.split('/').length === 3)).toBe(true);
    // The parse, not the repair: a single-stage Dockerfile is legitimate, and a
    // floor that demanded two stages would be asserting the shape this branch
    // happens to have chosen. What must hold is that the reader still sees
    // instructions at all.
    for (const dockerfile of DOCKERFILES) {
      const stages = readStages(readFileSync(join(REPO_ROOT, dockerfile), 'utf8'));
      const keywords = stages.flatMap((stage) => stage.instructions.map((instruction) => instruction.keyword));
      expect(stages.length, `${dockerfile}: parsed no stage`).toBeGreaterThanOrEqual(1);
      expect(keywords, `${dockerfile}: parsed no COPY`).toContain('COPY');
      expect(keywords, `${dockerfile}: parsed no RUN`).toContain('RUN');
    }
  });

  it('supplies the manifest of every member whose sources it copies', () => {
    const findings = DOCKERFILES.flatMap((dockerfile) =>
      analyse(dockerfile, readFileSync(join(REPO_ROOT, dockerfile), 'utf8'), MEMBERS),
    );
    expect(
      findings.map((finding) => `${finding.dockerfile} [${finding.kind}] ${finding.detail}`),
      'Derive the manifest set instead of listing it: add a `manifests` stage that copies the ' +
        'whole context and runs scripts/collect-workspace-manifests.sh, then ' +
        '`COPY --from=manifests /manifests/ ./` before the install.',
    ).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// 2. The analysis bites — one proof per finding it claims to report
// --------------------------------------------------------------------------

describe('the containment is decided by reading the file, not by trusting its shape', () => {
  const MEMBERS_FIXTURE = ['.', 'backend', 'packages/contracts', 'packages/modules/blog'];

  /**
   * `backend/Dockerfile` as it stood at 3d634ee5, reduced to the instructions
   * that matter. This is the red proof: the shape the repository shipped, and
   * the member it silently left out.
   */
  const LISTED = [
    'FROM node:22.17-slim AS base',
    'WORKDIR /app',
    'COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./',
    'COPY backend/package.json backend/package.json',
    'COPY packages/contracts/package.json packages/contracts/package.json',
    'RUN pnpm install --frozen-lockfile --filter backend...',
    'COPY packages/ packages/',
    'COPY backend/ backend/',
    'RUN pnpm --filter "backend^..." run build',
    '',
  ].join('\n');

  it('names the member a hand-written list has drifted past', () => {
    const findings = analyse('fixture/Dockerfile', LISTED, MEMBERS_FIXTURE);
    expect(findings.map((finding) => finding.kind)).toEqual(['unsupplied-member']);
    expect(findings[0]?.detail).toContain('packages/modules/blog');
  });

  it('accepts the derivation, and only in the shape that really is one', () => {
    const derived = [
      'FROM node:22.17-slim AS base',
      'FROM base AS manifests',
      'WORKDIR /ctx',
      'COPY . .',
      'RUN sh scripts/collect-workspace-manifests.sh /manifests',
      'FROM base AS app',
      'COPY --from=manifests /manifests/ ./',
      'RUN pnpm install --frozen-lockfile --filter backend...',
      'COPY packages/ packages/',
      'COPY backend/ backend/',
      '',
    ].join('\n');
    expect(analyse('fixture/Dockerfile', derived, MEMBERS_FIXTURE)).toEqual([]);

    // The same file with the collector replaced by a copy of a chosen subtree:
    // a stage this test cannot read is reported, never credited.
    const opaque = derived
      .replace('COPY . .', 'COPY packages/contracts/package.json /manifests/packages/contracts/package.json')
      .replace('RUN sh scripts/collect-workspace-manifests.sh /manifests', 'RUN true');
    const findings = analyse('fixture/Dockerfile', opaque, MEMBERS_FIXTURE);
    expect(findings.map((finding) => finding.kind)).toContain('unreadable-supply');
  });

  it('reports a file with no install rather than passing it vacuously', () => {
    const findings = analyse('fixture/Dockerfile', 'FROM scratch\nCOPY packages/ packages/\n', MEMBERS_FIXTURE);
    expect(findings.map((finding) => finding.kind)).toEqual(['no-install']);
  });

  it('reads a member arriving through a parent-directory copy', () => {
    // `COPY packages/ packages/` is how `packages/modules/blog` got into the
    // image without ever having been installed. If this stopped matching, the
    // proof above would go green for the wrong reason.
    const findings = analyse(
      'fixture/Dockerfile',
      LISTED.replace('COPY packages/ packages/', 'COPY backend/ backend/'),
      MEMBERS_FIXTURE,
    );
    expect(findings).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// 3. The derivation itself — run, not read
// --------------------------------------------------------------------------

describe('scripts/collect-workspace-manifests.sh enumerates the workspace', () => {
  function fixtureWorkspace(directories: readonly string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'workspace-manifests-'));
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - app\n  - packages/*\n  - packages/modules/*\n',
    );
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture-root', version: '0.0.0' }));
    for (const directory of directories) {
      mkdirSync(join(root, directory), { recursive: true });
      writeFileSync(
        join(root, directory, 'package.json'),
        JSON.stringify({ name: directory.replaceAll('/', '-'), version: '0.0.0' }),
      );
    }
    return root;
  }

  function collect(root: string): { readonly status: number; readonly output: string; readonly collected: readonly string[] } {
    const destination = join(root, '.collected');
    let status = 0;
    let output = '';
    try {
      output = execFileSync('sh', [COLLECTOR, destination], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      status = failure.status ?? 1;
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    }
    const collected: string[] = [];
    const walk = (relative: string): void => {
      const absolute = join(destination, relative);
      if (!existsSync(absolute)) return;
      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) walk(next);
        else collected.push(next);
      }
    };
    walk('');
    return { status, output, collected: collected.sort() };
  }

  it('collects every member, however deeply the workspace globs nest it', () => {
    const root = fixtureWorkspace(['app', 'packages/one', 'packages/modules/deep']);
    try {
      const result = collect(root);
      expect(result.status, result.output).toBe(0);
      expect(result.collected).toEqual([
        'app/package.json',
        'package.json',
        'packages/modules/deep/package.json',
        'packages/one/package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * The property the seven `COPY` lines did not have, and the reason this test
   * exists: a member that did not exist when anything was written is collected
   * because it is a member, not because somebody remembered it.
   */
  it('collects a member added after the fact, with nothing edited', () => {
    const root = fixtureWorkspace(['app']);
    try {
      expect(collect(root).collected).not.toContain('packages/modules/newcomer/package.json');
      mkdirSync(join(root, 'packages/modules/newcomer'), { recursive: true });
      writeFileSync(
        join(root, 'packages/modules/newcomer/package.json'),
        JSON.stringify({ name: 'newcomer', version: '0.0.0' }),
      );
      rmSync(join(root, '.collected'), { recursive: true, force: true });
      expect(collect(root).collected).toContain('packages/modules/newcomer/package.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 2 where a green would mean "nothing was read"', () => {
    const noWorkspace = mkdtempSync(join(tmpdir(), 'workspace-manifests-empty-'));
    try {
      writeFileSync(join(noWorkspace, 'package.json'), JSON.stringify({ name: 'lonely', version: '0.0.0' }));
      const result = collect(noWorkspace);
      expect(result.status).toBe(2);
      expect(result.output).toContain('pnpm-workspace.yaml');
    } finally {
      rmSync(noWorkspace, { recursive: true, force: true });
    }
  });

  it('collects this repository, blog and platform included', () => {
    const destination = mkdtempSync(join(tmpdir(), 'workspace-manifests-repo-'));
    try {
      const output = execFileSync('sh', [COLLECTOR, destination], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(output).toContain(`members=${MEMBERS.length}`);
      for (const member of MEMBERS) {
        const path = member === '.' ? 'package.json' : `${member}/package.json`;
        expect(existsSync(join(destination, path)), `${path} was not collected`).toBe(true);
      }
    } finally {
      rmSync(destination, { recursive: true, force: true });
    }
  });
});
