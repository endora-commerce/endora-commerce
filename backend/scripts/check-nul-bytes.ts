/**
 * CI check — no source file in this repository carries a raw NUL byte
 * (issue #190). **Repository-scope host** over the relocated analysis.
 *
 * The rule, its declared exclusions and its ledger live in
 * `@endora-commerce/cli/rules/nul-bytes.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). This file supplies the population — every file under this
 * repository's root — and prints the verdict; `endora check` supplies one module
 * package's. Neither re-derives the other's walk, and both decide membership
 * through the same `isScannablePath`, which is the rule rather than the walk.
 *
 * The forwarding specifier is **bare**, never a path into `dist`: one declared
 * spelling, therefore one copy in any process, which is
 * `check:singleton-identity`'s own rule applied to the machinery that enforces
 * it.
 *
 * Usage: `tsx scripts/check-nul-bytes.ts [--list]`
 * Exit 0 = no unledgered NUL byte; exit 1 = at least one, or a stale ledger
 * entry; exit 2 = nothing was read, so a pass would be vacuous.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  checkNulBytes,
  findNulBytes,
  GIT_BINARY_WINDOW,
  isScannablePath,
  isUnderSkippedPrefix,
  NUL_BYTES_ALLOWED,
  SKIPPED_DIRECTORIES,
  type ScannedFile,
} from '@endora-commerce/cli/rules/nul-bytes.js';

import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/nul-bytes.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRECTORIES[name] !== undefined) continue;
    const full = join(dir, name);
    if (isUnderSkippedPrefix(relative(REPO_ROOT, full))) continue;
    // A dangling symlink must not abort the walk, hence `throwIfNoEntry`.
    const stat = statSync(full, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

function main(): void {
  const listMode = process.argv.includes('--list');

  const files: ScannedFile[] = [];
  for (const full of walk(REPO_ROOT)) {
    const path = relative(REPO_ROOT, full).split('\\').join('/');
    if (!isScannablePath(path)) continue;
    files.push({ path, bytes: readFileSync(full) });
  }

  const result = checkNulBytes(files);
  if (result.scanned === 0) {
    console.error(
      '[nul-bytes] no scannable file under the repository root — refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  if (listMode) {
    for (const finding of findNulBytes(files)) {
      const tag = NUL_BYTES_ALLOWED[finding.path] !== undefined ? 'LEDGERED' : 'RAW NUL ';
      console.log(`${tag} ${finding.path}:${finding.line}:${finding.column} (x${finding.count})`);
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244). The population is the
  // whole repository minus two declared exclusions, so the file count is the
  // one number that says whether a new `SKIPPED_DIRECTORIES` entry quietly took
  // a subtree out of the scan. `self-reported`: nothing else in the tree
  // derives "every file that is not binary".
  reportReadSize({ prefix: '[nul-bytes]', files: result.scanned });
  console.log(
    `[nul-bytes] scanned=${result.scanned} files-with-a-raw-NUL=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(NUL_BYTES_ALLOWED).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA source file carries a raw NUL byte (issue #190).\n' +
        'Git classifies such a file as binary, so every diff of it reads "Binary files\n' +
        'differ" and the file stops being reviewable — which is how five of these\n' +
        'survived every review of every commit that touched them.\n' +
        'Spell the byte as an escape: `\\0` in a string or template literal produces\n' +
        'exactly the same byte at runtime, so no hash and no key changes.\n',
    );
    for (const finding of result.violations) {
      const window = finding.beyondGitBinaryWindow
        ? ` — past git's ${GIT_BINARY_WINDOW}-byte window, so git itself still calls it text`
        : '';
      console.error(
        `  - ${finding.path}:${finding.line}:${finding.column}  ${finding.count} NUL byte(s)${window}`,
      );
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (the file no longer carries a NUL — delete them):');
    for (const path of result.stale) console.error(`  - ${path}`);
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
