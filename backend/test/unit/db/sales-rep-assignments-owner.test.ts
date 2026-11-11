import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  BASELINE_MIGRATIONS,
  BASELINE_MIGRATION_INVENTORY,
} from '@endora-commerce/platform/migrations';

import { coreModuleDependencies } from '../../../src/db/configured-migrations.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import {
  buildTableOwners,
  collectSchemaFiles,
  schemaKeyOf,
  sourcesOf,
} from '../../../scripts/check-module-boundary.js';
import { loadPackageDeclarations } from '../../../scripts/lib/package-declarations.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import { readMigrationSources, repositoryOrder } from '../../helpers/instance-migration-order.js';
import { compositionOf } from '../../helpers/partial-composition.js';

/**
 * Issue #1033 — `organization_sales_rep_assignments` is created by the module
 * that owns it, and nothing about migration identity moved to get there.
 *
 * The run half — a fresh database migrated over the `organizations`
 * composition, then `quote_requests` arriving late — is
 * `test/integration/organizations/sales-rep-assignments-owner.test.ts`. This
 * file is the order and the static half: the instance-migration-order harness
 * over a composition that omits `quote_requests`, the owner map
 * `check:module-boundary` derives, and the identities a hard uninstall reverts
 * by.
 */

const TABLE = 'organization_sales_rep_assignments';
const REACH_GOVERNOR = 'Migration20261109T144721OrganizationsReachGovernor';
const QUOTE_REQUESTS_WORKFLOW = 'Migration20260503T141344QuoteRequestsWorkflow';

const SOURCES = await readMigrationSources();
const sourceOf = (name: string) => {
  const found = SOURCES.find((source) => source.name === name);
  if (found === undefined) throw new Error(`no migration source declares ${name}`);
  return found;
};

describe('organization_sales_rep_assignments — the owner creates it (#1033)', () => {
  it('is created before the reach governor names it, in a composition without quote_requests', () => {
    const modules = compositionOf('organizations');
    expect(modules.has('quote_requests')).toBe(false);
    const order = repositoryOrder({
      entries: MIGRATION_REGISTRY.filter((entry) => modules.has(entry.moduleId)),
      moduleDependencies: coreModuleDependencies(),
      baseline: BASELINE_MIGRATIONS,
    });
    const at = order.indexOf(REACH_GOVERNOR);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(order).not.toContain(QUOTE_REQUESTS_WORKFLOW);

    const creators = order
      .slice(0, at + 1)
      .filter((name) => SOURCES.find((source) => source.name === name)?.creates.includes(TABLE));
    expect(
      creators,
      `nothing in the organizations composition creates "${TABLE}" before ${REACH_GOVERNOR} ` +
        'puts its triggers on it — a fresh database without quote_requests stops there',
    ).toEqual([REACH_GOVERNOR]);
  });

  it('is created by exactly two migrations, both guarded, with one shape — the indexes by the owner alone', () => {
    const creators = SOURCES.filter((source) => source.creates.includes(TABLE));
    expect(creators.map((source) => [source.moduleId, source.name]).sort()).toEqual([
      ['organizations', REACH_GOVERNOR],
      ['quote_requests', QUOTE_REQUESTS_WORKFLOW],
    ]);

    const statementsOf = (file: string): string[] => {
      const text = readFileSync(file, 'utf8').replace(/\s+/g, ' ');
      return [
        ...text.matchAll(
          new RegExp(`create (?:table|index)(?: if not exists)? (?:"[a-z_]+" on )?"${TABLE}"[^;]*;`, 'gi'),
        ),
      ].map((match) => match[0]);
    };
    const owner = statementsOf(sourceOf(REACH_GOVERNOR).file);
    const historical = statementsOf(sourceOf(QUOTE_REQUESTS_WORKFLOW).file);
    // The owner creates the table and its two indexes, every statement
    // `if not exists`. The historical creator keeps the table alone, guarded
    // and identical to the owner's, so whichever runs first creates the one
    // shape and the other does nothing. Its two indexes went to the owner
    // (D-291 R-A8): after a create that may have been a no-op, an index on a
    // table another module maps is a write the foreign-schema guard refuses in
    // an instance.
    expect(owner).toHaveLength(3);
    for (const statement of [...owner, ...historical]) expect(statement).toMatch(/ if not exists /i);
    expect(historical).toEqual([owner[0]]);
  });

  it('keeps every migration identity: no new class, the workflow still quote_requests\'', () => {
    expect(BASELINE_MIGRATION_INVENTORY).toContainEqual({
      name: QUOTE_REQUESTS_WORKFLOW,
      moduleId: 'quote_requests',
    });
    const registered = (moduleId: string) =>
      MIGRATION_REGISTRY.filter((entry) => entry.moduleId === moduleId).map((entry) => entry.cls.name);
    expect(registered('organizations')).toContain(REACH_GOVERNOR);
    expect(registered('quote_requests')).toContain(QUOTE_REQUESTS_WORKFLOW);
  });

  it('is attributed to organizations by check:module-boundary, with no ledger entry', async () => {
    const layout = await requireModuleLayout('[#1033]');
    const owners = buildTableOwners(
      sourcesOf(collectSchemaFiles(layout.sourceRoots), schemaKeyOf(layout)),
      (await loadPackageDeclarations()).tables,
      layout.hostResidentModules,
    ).owners;
    expect(owners.get(TABLE)?.id).toBe('organizations');
  }, 120_000);
});
