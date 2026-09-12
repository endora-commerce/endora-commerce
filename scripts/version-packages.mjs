#!/usr/bin/env node
/**
 * The version step — `changeset version` on a release branch, with the two
 * guards a bare command cannot have (feature 080, T043).
 *
 * ## Why this runs locally and not in CI
 *
 * It is a workflow decision and the reasoning belongs where a reader will find
 * it, so: three shapes were on the table and two of them cannot be built here.
 *
 *   * **A CI job that versions and pushes.** It needs a credential that can
 *     write to the default branch. `CI_JOB_TOKEN` cannot, so it means a project
 *     access token — release infrastructure, which D-160.5 defers to the merge
 *     request that makes a package public. It would also put a bot commit
 *     straight onto `master`, which this repository's working agreement forbids
 *     for a human and has no reason to allow for a robot: a version bump is a
 *     change to `packages/`, and every change to `packages/` is reviewed.
 *   * **A scheduled job.** Same credential, plus a worse property: it decides
 *     *when* to release, and nothing about this repository makes a calendar the
 *     right answer to that. Nothing is published; a release here is a changelog
 *     and a number, and both are wanted at a moment somebody chooses.
 *   * **A local step that produces a merge request.** This one. It lands
 *     through the same gate as every other change to `packages/`, needs no
 *     credential CI does not already have, and the reviewer sees the diff that
 *     the changelog was generated from.
 *
 * What a local step cannot have is a pipeline reminding you it still works, and
 * that is answered elsewhere rather than waved away: `check:release-intent`
 * runs in the `quality` job on **every** merge request and refuses the config
 * under which this command would exit 0 having done nothing.
 *
 * ## The two guards
 *
 * `changeset version` exits **0** when it bumps nothing. Measured on this
 * repository, with `privatePackages.version` at the `@changesets/config@4`
 * default of `false` and a pending changeset naming `@b2b/contracts` — the
 * package's name that day, before T042e renamed the scope: exit 0,
 * "All files have been updated", no version moved, and the changeset file still
 * on disk. That is the shape this repository has been bitten by seven times —
 * an operation whose green is indistinguishable from its no-op — so:
 *
 *   1. **Refuse when there is nothing to consume.** A release of no changesets
 *      is a branch that changes `packages/` for no stated reason.
 *   2. **Refuse when the run moved nothing it consumed.** Every package named
 *      in the pending front matter must come out with a different `version`.
 *      This is the same predicate `release:changeset` applies to the resulting
 *      merge request, from the other side of the diff.
 *
 * Both restore the tree before exiting, so a refusal costs nothing.
 *
 * Usage:  pnpm run version:packages [--base <branch>] [--branch <name>]
 * Exit 0 = a release branch is ready to push; 1 = refused; 2 = it did not run.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const PREFIX = '[version-packages]';

const argument = (flag, fallback) => {
  const at = process.argv.indexOf(flag);
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
};

const git = (...args) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

function refuse(code, message) {
  console.error(`${PREFIX} ${message}`);
  process.exit(code);
}

/** Every package name named by the front matter of a pending changeset. */
function pendingReleases() {
  const dir = join(REPO_ROOT, '.changeset');
  const names = new Set();
  let files = [];
  try {
    files = readdirSync(dir).filter(
      (name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md',
    );
  } catch {
    refuse(2, '`.changeset/` could not be listed — refusing to guess what would be released.');
  }
  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8');
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
    if (front === null) continue;
    for (const line of (front[1] ?? '').split('\n')) {
      const entry = /^\s*(?:"([^"]+)"|'([^']+)'|([^:\s]+))\s*:\s*(\S+)\s*$/.exec(line);
      if (entry === null) continue;
      names.add(entry[1] ?? entry[2] ?? entry[3]);
    }
  }
  return { files, names: [...names] };
}

/** `name -> version` for every workspace manifest git currently tracks. */
function trackedVersions() {
  const versions = new Map();
  for (const path of git('ls-files', '--', '*/package.json', 'package.json').split('\n')) {
    if (path === '' || path.includes('node_modules/')) continue;
    const full = join(REPO_ROOT, path);
    if (!existsSync(full)) continue;
    try {
      const manifest = JSON.parse(readFileSync(full, 'utf8'));
      if (typeof manifest.name === 'string') versions.set(manifest.name, manifest.version);
    } catch {
      // A manifest that does not parse is not a package this step can release;
      // `check:release-intent` is what reports it, and it reports it loudly.
    }
  }
  return versions;
}

/**
 * The number this release is named after — **the highest version any package
 * reaches**, read out of the changesets CLI's own plan.
 *
 * The branch name used to be a date, and the convention in this repository is a
 * version: the only release branch that has ever existed is
 * `release/version-0.7.0`. A date is also the wrong shape for the protected
 * pattern's purpose — `release/version-*` is protected so that the publish job
 * can resolve its credentials, and an operator reading the branch list wants to
 * know *what* is being published, not *when* somebody ran the command.
 *
 * It is **asked of `changeset status`** rather than computed here. That command
 * is the CLI's own answer to "what would this release do", it already runs in
 * `release:changeset` on every merge request, and a second implementation of
 * the bump arithmetic would be two answers to one question waiting to disagree
 * — the reason `specs/114-release-shape-gate/` FR-007 forbids reimplementing it.
 *
 * **A release is not uniform, and the name is therefore an approximation**, said
 * here rather than discovered: the release of 2026-09-11 moved 68 packages to
 * `0.8.0` and 15 to `0.7.1`. The highest is the series marker — it is the number
 * the next release counts from — and a name cannot carry both.
 */
function plannedReleaseNumber() {
  const directory = mkdtempSync(join(tmpdir(), 'version-packages-'));
  const file = join(directory, 'plan.json');
  try {
    const status = spawnSync('pnpm', ['exec', 'changeset', 'status', '--output', file], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (status.status !== 0 || !existsSync(file)) {
      refuse(
        2,
        '`changeset status` did not produce a release plan, so this run cannot name the branch ' +
          'after the version it would publish. Pass `--branch release/version-<n>` if you know ' +
          'the number, and find out why the CLI could not answer before you release.',
      );
    }
    const plan = JSON.parse(readFileSync(file, 'utf8'));
    const versions = (plan.releases ?? [])
      .map((release) => release.newVersion)
      .filter((version) => typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version));
    if (versions.length === 0) {
      refuse(
        2,
        'the release plan names no new version. `version:packages` refuses a run that moves ' +
          'nothing a few lines below; this is the same refusal one step earlier, where it can ' +
          'still tell you before a branch exists.',
      );
    }
    const key = (version) => version.split('.').map((part) => Number.parseInt(part, 10));
    return versions.sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    })[0];
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function main() {
  const base = argument('--base', 'master');

  if (git('status', '--porcelain') !== '') {
    refuse(
      2,
      'the working tree is dirty. `changeset version` rewrites every manifest it bumps, so a ' +
        'refusal could not tell your changes from its own. Commit or discard first.',
    );
  }

  const head = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (head !== base) {
    refuse(
      2,
      `HEAD is \`${head}\` and the base is \`${base}\`. A release branch is cut from the branch ` +
        'it will merge back into, or the bump is computed against versions that are not the ' +
        `ones on \`${base}\`. Pass \`--base ${head}\` if that is genuinely what you want.`,
    );
  }

  const pending = pendingReleases();
  if (pending.files.length === 0) {
    refuse(
      1,
      'there is no changeset to consume. A release of nothing is a branch that changes ' +
        '`packages/` and says nothing about why — write the intent first (`pnpm changeset`).',
    );
  }
  if (pending.names.length === 0) {
    refuse(
      1,
      `${pending.files.length} changeset file(s) are present and none of them names a package. ` +
        'They are all empty changesets — a record that a change carried no release meaning, ' +
        'which is exactly the thing that does not need a version bump.',
    );
  }

  const before = trackedVersions();
  const branch = argument('--branch', `release/version-${plannedReleaseNumber()}`);

  // Two releases that would publish the same highest version land on one name —
  // a re-cut after an abandoned attempt is the ordinary case. Refuse it rather
  // than letting `git checkout
  // -b` throw: the throw is a stack trace on a run that has already changed
  // nothing, which reads like a defect in this script instead of a question for
  // the operator — and the answer is theirs, since the standing branch may be a
  // release under review or an abandoned attempt.
  if (git('branch', '--list', branch) !== '') {
    refuse(
      2,
      `the branch \`${branch}\` already exists. If it is a release under review, merge or ` +
        'close it first; if it is an abandoned attempt, delete it. Pass `--branch <name>` to ' +
        'use a different one.',
    );
  }
  git('checkout', '-q', '-b', branch);

  const versioned = spawnSync('pnpm', ['run', 'changeset:version'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  const restore = () => {
    git('checkout', '-q', '--', '.');
    git('clean', '-qfd', '--', '.changeset', 'packages');
    git('checkout', '-q', base);
    git('branch', '-qD', branch);
  };

  if (versioned.status !== 0) {
    restore();
    refuse(1, `\`changeset version\` exited ${String(versioned.status)}; nothing was committed.`);
  }

  // The guard that matters. `changeset version` reports success for a run that
  // bumped nothing, so success is not the question — movement is.
  const after = trackedVersions();
  const unmoved = pending.names.filter((name) => before.get(name) === after.get(name));
  if (unmoved.length > 0) {
    restore();
    refuse(
      1,
      `\`changeset version\` exited 0 and did not move ${unmoved.join(', ')}, which the pending ` +
        'changesets name. That is what a broken `.changeset/config.json` looks like from here — ' +
        '`privatePackages.version` at the `@changesets/config@4` default of `false` produces ' +
        'exactly this. Run `pnpm --filter backend run check:release-intent` for the reason.',
    );
  }

  git('add', '--', '.changeset', 'packages');
  git('commit', '-q', '-m', 'chore: version packages');

  const moved = pending.names
    .map((name) => `${name} ${String(before.get(name))} -> ${String(after.get(name))}`)
    .sort();
  console.log(`\n${PREFIX} ${branch} is ready. Released:`);
  for (const line of moved) console.log(`  - ${line}`);
  console.log(
    `\n${PREFIX} open the merge request:\n` +
      `  git push -o merge_request.create -o merge_request.remove_source_branch -u origin ${branch}\n`,
  );
}

try {
  main();
} catch (error) {
  // A git invocation that failed is a refusal, not a crash. Without this the
  // operator gets a `child_process` stack trace and has to read it to find the
  // one line git wrote — on a run that may have left a branch behind.
  if (error instanceof Error && 'status' in error) {
    const stderr = 'stderr' in error ? String(error.stderr).trim() : '';
    refuse(2, `a git command failed and this run stopped where it was.\n  ${stderr || error.message}`);
  }
  throw error;
}
