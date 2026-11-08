import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #305 — a sales representative's tenant reach is the **complement** of
 * the organizations governed by somebody else (`excluded-set`). The id list
 * behind that complement is a filter input, and only the platform's tenancy
 * directory turns it into a predicate.
 *
 * Why a module may not read it: the usual consumer shape before #305 was
 * `constraint.kind === 'set' ? <narrow to the ids> : <no filter>`. A module
 * reading the excluded ids and getting the polarity wrong — `$in` where it
 * meant `$nin` — would confine a representative to exactly the organizations
 * they may *not* see; a module branching on the tenant **mode** and treating
 * an unknown one as "no filter" would widen them to everything. Both are
 * silent. So the helpers (`orgScopeWhere`, `orgScopeSql`, `isOrgInScope`,
 * `ruleVisibleForScope`, `assignedOrganizationIdsForRanking`) are the only way
 * in, and this file holds that:
 *
 *  - no source file under `packages/modules/<id>/src` names
 *    `excludedOrganizationIds`, except the producer — `organizations`, which
 *    computes the set and answers it on `adminTenantScopePort`. A module's
 *    *test* may build an `excluded` constraint to drive the helpers with;
 *  - no source file there names a tenant mode spelling (`'allowed-set'`,
 *    `'excluded-set'`): a module reads the constraint, never the mode. A
 *    module's *test* may observe the mode it ran under (`auth`'s route-actor
 *    test does), which decides nothing.
 *
 * The allowlist is explicit and commented. Adding to it is a review question,
 * not a formality.
 */
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
const MODULES = join(REPO_ROOT, 'packages', 'modules');

const EXCLUDED_IDS_PRODUCERS = new Set([
  // The port that answers the tenant reach: it hands the set to the platform.
  'packages/modules/organizations/src/backend/services/admin-tenant-scope.ts',
  // The one statement that computes it, and its pure decision half.
  'packages/modules/organizations/src/backend/services/sales-rep-assignment-service.ts',
  'packages/modules/organizations/src/backend/services/sales-rep-reach.ts',
]);

/** No module reads the tenant mode today; an entry here needs a reason beside it. */
const MODE_READERS = new Set<string>([]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const moduleSources = (): Array<{ file: string; text: string }> =>
  readdirSync(MODULES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const src = join(MODULES, entry.name, 'src');
      try {
        return sourceFiles(src);
      } catch {
        return [];
      }
    })
    .map((path) => ({ file: relative(REPO_ROOT, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));

describe('#305 — the excluded organization ids stay in the platform', () => {
  const files = moduleSources();

  it('reads module sources at all', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no module but the producer names `excludedOrganizationIds`', () => {
    const offenders = files
      .filter(({ file, text }) => !/\.test\.tsx?$/.test(file) && text.includes('excludedOrganizationIds'))
      .map(({ file }) => file)
      .filter((file) => !EXCLUDED_IDS_PRODUCERS.has(file));
    expect(offenders).toEqual([]);
  });

  it('no module names a tenant mode', () => {
    const offenders = files
      .filter(({ file, text }) => !/\.test\.tsx?$/.test(file) && /'(allowed|excluded)-set'/.test(text))
      .map(({ file }) => file)
      .filter((file) => !MODE_READERS.has(file));
    expect(offenders).toEqual([]);
  });

  it('every allowlisted file still exists and still needs its entry', () => {
    const byFile = new Map(files.map(({ file, text }) => [file, text]));
    for (const file of EXCLUDED_IDS_PRODUCERS) {
      expect(byFile.get(file), file).toContain('excludedOrganizationIds');
    }
  });
});
