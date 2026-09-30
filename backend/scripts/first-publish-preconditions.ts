/**
 * The first npmjs publish's registry precondition — the network half of 123
 * T7-D1 (`specs/137-open-source-launch/` N4, D-234).
 *
 * `check:release-intent --publish-registry` refuses a package below the first
 * public version, `0.100.0`, and it makes no network call: the check estate
 * never does. What it therefore cannot see is whether this publish really is
 * the **first**. That matters because D-234's one uniform number is a property
 * of the first release only — from the second on the estate diverges again, as
 * it always has — and because a version on npmjs is permanent. So the publish
 * job asks the registry, immediately before `changeset publish`:
 *
 *   1. **every package carries one number** — the set `changeset publish` will
 *      publish, derived by `check:release-intent`'s own classification
 *      (versionable and not private), never a list; and
 *   2. **no package already holds a public version at or above the floor**,
 *      other than that very number. A package that already holds the number is
 *      a resumed run — a first publish that stopped part-way — and
 *      `changeset publish` skips it; any other version at or above the floor
 *      means this is not the first publish, and the uniform set is illegal.
 *
 * A version **below** the floor is neither: it is the owner's `0.0.1`
 * placeholder of an unscoped name (D-267), which a first release publishes over.
 *
 * A registry answer that could not be read — anything but a version list or an
 * `E404` — is **unmeasured** and exits 2, never read as "absent": absent is the
 * permissive answer, in the one direction nobody can take back.
 *
 * A registry that is not public npmjs is not judged (exit 0, said so): the
 * rule is about npmjs's permanence.
 *
 * **Retiring condition**: deleted, with `FIRST_PUBLIC_VERSION` and
 * `publicVersionFloor`, by the merge request after the first npmjs publish. Left
 * in place it refuses the second release, which is the point — it cannot
 * silently outlive its subject.
 *
 * Usage: `tsx scripts/first-publish-preconditions.ts --registry <url> [--root <dir>]`
 * Exit 0 = the precondition holds (or the registry is not public npmjs);
 * 1 = refused; 2 = it could not measure.
 */
/* eslint-disable no-console -- CLI precondition: stdout/stderr is the interface. */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  FIRST_PUBLIC_VERSION,
  isBelow,
  publishTargetOf,
  readReleaseIntent,
} from './check-release-intent.js';
import { nodeWorkspaceFs } from './lib/workspace-packages.js';

const PREFIX = '[first-publish]';

/** One package `changeset publish` would publish. */
export interface PublishCandidate {
  readonly name: string;
  readonly version: string;
}

/** What the registry answered about one package name. */
export type RegistryAnswer =
  | { readonly kind: 'absent' }
  | { readonly kind: 'versions'; readonly versions: readonly string[] }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** The verdict over the whole set. */
export interface FirstPublishVerdict {
  /** The one number the set carries, or `null` when it carries more than one. */
  readonly number: string | null;
  /** One line per package, for the log. */
  readonly lines: readonly string[];
  /** Why the publish is refused. Empty when it is not. */
  readonly refusals: readonly string[];
  /** Packages whose registry answer could not be read. */
  readonly unmeasured: readonly string[];
}

/**
 * Reads `npm view <name> versions --json`: an array, or the bare string npm
 * prints when there is exactly one version; `E404` in the JSON error body is
 * absent, and every other shape is unreadable.
 */
export function readRegistryAnswer(status: number | null, stdout: string): RegistryAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: 'unreadable', reason: `exit ${String(status)}, output is not JSON` };
  }
  if (status === 0) {
    if (typeof parsed === 'string') return { kind: 'versions', versions: [parsed] };
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
      return { kind: 'versions', versions: parsed as string[] };
    }
    return { kind: 'unreadable', reason: 'exit 0 without a version list' };
  }
  const error =
    typeof parsed === 'object' && parsed !== null && 'error' in parsed
      ? (parsed as { error: { code?: unknown; summary?: unknown } }).error
      : null;
  if (error !== null && error.code === 'E404') return { kind: 'absent' };
  const code = typeof error?.code === 'string' ? error.code : `exit ${String(status)}`;
  const summary = typeof error?.summary === 'string' ? ` ${error.summary}` : '';
  return { kind: 'unreadable', reason: `${code}${summary}` };
}

/** Pure: the verdict over the set, the registry's answers and the floor. */
export function judgeFirstPublish(
  set: readonly PublishCandidate[],
  answers: ReadonlyMap<string, RegistryAnswer>,
  floor: string,
): FirstPublishVerdict {
  if (set.length === 0) {
    return {
      number: null,
      lines: [],
      refusals: ['the publish set is empty, so there is nothing to call a first publish'],
      unmeasured: [],
    };
  }

  const refusals: string[] = [];
  const unmeasured: string[] = [];
  const lines: string[] = [];

  const numbers = [...new Set(set.map((candidate) => candidate.version))].sort();
  const number = numbers.length === 1 ? numbers[0]! : null;
  if (number === null) {
    refusals.push(
      `the set carries ${String(numbers.length)} versions (${numbers.join(', ')}), and a first ` +
        'public release carries one (D-234): ' +
        set.map((candidate) => `${candidate.name}@${candidate.version}`).join(', '),
    );
  }

  for (const candidate of [...set].sort((a, b) => a.name.localeCompare(b.name))) {
    const answer = answers.get(candidate.name);
    if (answer === undefined) {
      unmeasured.push(`${candidate.name}: the registry was not asked`);
      continue;
    }
    if (answer.kind === 'unreadable') {
      unmeasured.push(`${candidate.name}: ${answer.reason}`);
      continue;
    }
    if (answer.kind === 'absent') {
      lines.push(`${candidate.name}: not on the registry`);
      continue;
    }
    const atOrAbove = answer.versions.filter((version) => isBelow(version, floor) !== true);
    const conflicting = atOrAbove.filter((version) => version !== candidate.version);
    if (conflicting.length > 0) {
      refusals.push(
        `${candidate.name} already holds ${conflicting.join(', ')} on the registry, at or above ` +
          `the first public version ${floor}, so this is not the first publish and D-234's ` +
          'uniform number does not apply. Delete this precondition in the merge request after ' +
          'the first publish, and release through `changeset version` from then on',
      );
      continue;
    }
    if (atOrAbove.includes(candidate.version)) {
      lines.push(`${candidate.name}: ${candidate.version} already published (a resumed run; skipped)`);
      continue;
    }
    lines.push(`${candidate.name}: ${answer.versions.join(', ')} below the floor`);
  }

  return { number, lines, refusals, unmeasured };
}

function ask(name: string, registry: string): RegistryAnswer {
  const result = spawnSync('npm', ['view', name, 'versions', '--json', '--registry', registry], {
    encoding: 'utf8',
  });
  if (result.error !== undefined) return { kind: 'unreadable', reason: result.error.message };
  return readRegistryAnswer(result.status, result.stdout);
}

function main(): void {
  const flag = (name: string): string | undefined => {
    const at = process.argv.indexOf(name);
    const value = at >= 0 ? process.argv[at + 1] : undefined;
    return value === undefined || value.startsWith('--') ? undefined : value;
  };
  const registry = flag('--registry');
  if (registry === undefined) {
    console.error(`${PREFIX} \`--registry\` needs a URL; refusing to judge a publish it cannot name.`);
    process.exit(2);
  }
  const target = publishTargetOf(registry);
  if (target === null) {
    console.error(`${PREFIX} the registry \`${registry}\` is not a URL; refusing to guess.`);
    process.exit(2);
  }
  if (target !== 'public-npmjs') {
    console.log(`${PREFIX} ${registry} is not public npmjs; the first-public-version rule does not apply.`);
    return;
  }

  const root = flag('--root') ?? fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
  const inputs = readReleaseIntent(root, nodeWorkspaceFs(), (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch {
      return null;
    }
  });
  if ('reason' in inputs) {
    console.error(`${PREFIX} ${inputs.reason}; refusing to judge a publish it did not read.`);
    process.exit(2);
  }

  // The population `changeset publish` publishes: versionable and not private —
  // `check:release-intent`'s classification, never a list.
  const set: PublishCandidate[] = inputs.members
    .filter((member) => member.family && !member.isPrivate)
    .map((member) => ({ name: member.name, version: member.version ?? '' }));
  const answers = new Map(set.map((candidate) => [candidate.name, ask(candidate.name, registry)] as const));
  const verdict = judgeFirstPublish(set, answers, FIRST_PUBLIC_VERSION);

  for (const line of verdict.lines) console.log(`${PREFIX} ${line}`);
  console.log(
    `${PREFIX} packages=${String(set.length)} number=${verdict.number ?? 'mixed'} ` +
      `floor=${FIRST_PUBLIC_VERSION} refused=${String(verdict.refusals.length)} ` +
      `unmeasured=${String(verdict.unmeasured.length)}`,
  );
  for (const refusal of verdict.refusals) console.error(`${PREFIX} refused: ${refusal}.`);
  for (const entry of verdict.unmeasured) console.error(`${PREFIX} unmeasured: ${entry}.`);

  if (verdict.refusals.length > 0) process.exit(1);
  if (verdict.unmeasured.length > 0) process.exit(2);
}

// Run as CLI only — importing this module from a test must not reach the network.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
