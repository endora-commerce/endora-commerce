/**
 * One-shot derivation of the frozen legacy migration rename map.
 *
 * Implements specs/065-manifest-aware-migrations/contracts/legacy-rename-map.md
 * §2.2 verbatim. It is committed for auditability only — it is not wired into
 * any build, and its output (backend/src/db/legacy-migration-names.ts) is
 * frozen once committed.
 *
 * Usage:
 *   pnpm --filter backend exec tsx scripts/derive-legacy-migration-timestamps.ts
 *
 * Inputs:
 *   - The pre-rename `migrationsList` array order, which is what deployed
 *     databases actually executed. Read from backend/var/065-baseline/
 *     historical-order.txt when present (captured before the rename), and
 *     otherwise re-extracted from the config snapshot at LEGACY_CONFIG_REF.
 *   - The pre-rename import statements of the same config snapshot, which map
 *     each legacy class name to the migration file's path.
 *
 * Output: the full LEGACY_MIGRATION_RENAMES array literal on stdout, plus a
 * summary of the measured facts asserted by the contract.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The master merge commit this feature branched from — the pre-rename tree. */
const LEGACY_CONFIG_REF = '8771dcd9';
const CONFIG_PATH = 'backend/src/db/mikro-orm.config.ts';
const EXPECTED_COUNT = 112;

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..');
const repoRoot = resolve(backendRoot, '..');

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function readLegacyConfig(): string {
  return git(['show', `${LEGACY_CONFIG_REF}:${CONFIG_PATH}`]);
}

/** Legacy class name → repo-relative migration file path. */
function importedPaths(configSource: string): Map<string, string> {
  const paths = new Map<string, string>();
  const importRe = /^import \{ (Migration\w+) \} from '([^']+)';$/gm;
  for (const match of configSource.matchAll(importRe)) {
    const className = match[1]!;
    const specifier = match[2]!.replace(/\.js$/, '.ts');
    const absolute = resolve(backendRoot, 'src/db', specifier);
    paths.set(className, absolute.slice(repoRoot.length + 1));
  }
  return paths;
}

/** The `migrationsList` array order — the historical execution order. */
function historicalOrder(configSource: string): string[] {
  const baseline = resolve(backendRoot, 'var/065-baseline/historical-order.txt');
  if (existsSync(baseline)) {
    return readFileSync(baseline, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  return [...configSource.matchAll(/name: '(Migration\w+)'/g)].map((match) => match[1]!);
}

function addDate(path: string, follow: boolean): string {
  const args = ['log'];
  if (follow) args.push('--follow');
  args.push('--diff-filter=A', '--format=%aI', '-1', '--', path);
  return git(args);
}

function oldestCommitDate(path: string): string {
  const all = git(['log', '--format=%aI', '--', path])
    .split('\n')
    .filter((line) => line.length > 0);
  return all[all.length - 1] ?? '';
}

/** ISO instant → 'YYYYMMDDTHHmmss' in UTC, truncated to whole seconds. */
function toStamp(epochMs: number): string {
  return new Date(Math.floor(epochMs / 1000) * 1000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');
}

/**
 * The owning module segment of a migration path, per
 * contracts/naming-convention.md §1 (leading underscore stripped; the
 * cross-cutting backend/src/db/migrations/ directory is `core`).
 */
function ownerOf(path: string): { moduleId: string; segment: string } {
  const moduleMatch = /^backend\/src\/modules\/([^/]+)\/migrations\//.exec(path);
  if (moduleMatch) {
    const moduleId = moduleMatch[1]!;
    return { moduleId, segment: moduleId.replace(/^_/, '') };
  }
  if (path.startsWith('backend/src/db/migrations/')) return { moduleId: 'core', segment: 'core' };
  throw new Error(`Cannot determine the owning module of ${path}`);
}

/**
 * New filename tail: the legacy filename's descriptive tail, prefixed with the
 * owning segment unless it already starts with it (which is why
 * `002_quote_requests_init.ts` becomes `<stamp>_quote_requests_init.ts` and not
 * `<stamp>_quote_requests_quote_requests_init.ts`).
 */
function tailFor(segment: string, legacyFilename: string): string {
  const slug = /^\d+_([a-z0-9_]+)\.ts$/.exec(legacyFilename)?.[1];
  if (!slug) throw new Error(`Unexpected legacy migration filename: ${legacyFilename}`);
  return slug === segment || slug.startsWith(`${segment}_`) ? slug : `${segment}_${slug}`;
}

function classNameFor(stamp: string, tail: string): string {
  const pascal = tail
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return `Migration${stamp}${pascal}`;
}

interface DerivedRename {
  legacyName: string;
  name: string;
  path: string;
  newFilename: string;
  moduleId: string;
  clamped: boolean;
  followMattered: boolean;
  usedFallback: boolean;
}

function main(): void {
  const configSource = readLegacyConfig();
  const paths = importedPaths(configSource);
  const order = historicalOrder(configSource);

  if (order.length !== EXPECTED_COUNT) {
    throw new Error(`Expected ${EXPECTED_COUNT} migrations, found ${order.length}`);
  }

  const derived: DerivedRename[] = [];
  let previousMs = 0;

  for (const legacyName of order) {
    const path = paths.get(legacyName);
    if (!path) throw new Error(`No import found for ${legacyName} in ${CONFIG_PATH}`);

    const followed = addDate(path, true);
    const unfollowed = addDate(path, false);
    const usedFallback = followed.length === 0;
    const iso = usedFallback ? oldestCommitDate(path) : followed;
    if (iso.length === 0) throw new Error(`No commit date at all for ${path}`);

    const candidateMs = Math.floor(new Date(iso).getTime() / 1000) * 1000;
    const clampedMs = Math.max(candidateMs, previousMs + 1000);
    const clamped = clampedMs !== candidateMs;
    previousMs = clampedMs;

    const stamp = toStamp(clampedMs);
    const legacyFilename = path.slice(path.lastIndexOf('/') + 1);
    const { moduleId, segment } = ownerOf(path);
    const tail = tailFor(segment, legacyFilename);

    derived.push({
      legacyName,
      name: classNameFor(stamp, tail),
      path,
      newFilename: `${stamp}_${tail}.ts`,
      moduleId,
      clamped,
      followMattered: !usedFallback && followed !== unfollowed,
      usedFallback,
    });
  }

  const width = Math.max(...derived.map((entry) => entry.legacyName.length)) + 3;
  process.stdout.write('export const LEGACY_MIGRATION_RENAMES: readonly LegacyMigrationRename[] = [\n');
  for (const entry of derived) {
    const legacy = `'${entry.legacyName}',`.padEnd(width);
    process.stdout.write(`  { legacyName: ${legacy} name: '${entry.name}' },\n`);
  }
  process.stdout.write('];\n');

  // Renames, as `<old path>\t<new path>` — consumed by the rename step.
  process.stdout.write('\n// --- file renames ---\n');
  for (const entry of derived) {
    const newPath = `${entry.path.slice(0, entry.path.lastIndexOf('/'))}/${entry.newFilename}`;
    process.stdout.write(`// RENAME\t${entry.path}\t${newPath}\t${entry.legacyName}\t${entry.name}\t${entry.moduleId}\n`);
  }

  const follow = derived.filter((entry) => entry.followMattered);
  const fallback = derived.filter((entry) => entry.usedFallback);
  const clamps = derived.filter((entry) => entry.clamped);
  process.stdout.write('\n// --- summary ---\n');
  process.stdout.write(`// entries: ${derived.length}\n`);
  process.stdout.write(`// --follow changed the date for ${follow.length} file(s):\n`);
  for (const entry of follow) process.stdout.write(`//   ${entry.path}\n`);
  process.stdout.write(`// no --diff-filter=A date, oldest-commit fallback used for ${fallback.length} file(s):\n`);
  for (const entry of fallback) process.stdout.write(`//   ${entry.path}\n`);
  process.stdout.write(`// clamped to previous + 1s: ${clamps.length} file(s):\n`);
  for (const entry of clamps) process.stdout.write(`//   ${entry.path}\n`);
}

main();
