import { MikroORM } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PLATFORM_ENTITIES,
  auditForeignSchemaWrites,
  committedModuleDependencies,
  type ForeignWriteAudit,
} from '@endora-commerce/platform/db';
import { FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS } from '@endora-commerce/platform/migrations';

import { buildTableOwners, scanModuleBoundaryTree } from '../../../scripts/check-module-boundary.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';
import { instanceContributions } from '../../helpers/instance-migration-order.js';

/**
 * `specs/178-extensible-columns/` FR-071 (tasks.md T065) — an instance that
 * installs every first-party module as a package migrates through the
 * foreign-schema guard without a refusal.
 *
 * In an instance every module arrives `external`, so every one of this
 * repository's migrations runs inside the guard. Each is dry-run here — `up()`
 * and `down()`, statements queued and never executed — and held to the guard's
 * own verdict, with the exemptions `composer:generate` renders from R2's
 * ledger. A first-party migration that writes another module's table and is
 * not in that ledger would stop a client's `migrate`; this is where it shows.
 *
 * Ownership is `check:module-boundary`'s owner map — R2's own derivation, which
 * is what the exemptions are recorded against — standing in for the runtime's
 * "entities ∪ creates", which needs each package's discovered entity classes.
 */

let orm: MikroORM;
let audit: ForeignWriteAudit;
let unexempted: ForeignWriteAudit;

beforeAll(async () => {
  orm = await MikroORM.init({ ...(await mikroOrmConfig()), connect: false });
  const layout = await requireModuleLayout('[instance-foreign-writes]');
  const scan = await scanModuleBoundaryTree(layout);
  const owners = buildTableOwners(scan.input.schema, scan.input.packageTables, scan.input.hostResidentModules).owners;
  const ownedBy = new Map<string, Set<string>>();
  for (const [table, owner] of owners) {
    const set = ownedBy.get(owner.id) ?? new Set<string>();
    set.add(table);
    ownedBy.set(owner.id, set);
  }
  const packages = instanceContributions(MIGRATION_REGISTRY, committedModuleDependencies(DISCOVERED_MANIFESTS));
  const inputs = {
    packages,
    driver: orm.em.getDriver(),
    config: orm.config,
    platformEntities: PLATFORM_ENTITIES,
    ownTables: (moduleId: string) => new Set([...(ownedBy.get(moduleId) ?? []), ...(ownedBy.get('kernel') ?? [])]),
  };
  audit = await auditForeignSchemaWrites({ ...inputs, exemptions: FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS });
  unexempted = await auditForeignSchemaWrites({ ...inputs, exemptions: [] });
}, 600_000);

afterAll(async () => {
  await orm?.close(true);
});

describe('an instance of every first-party module, through the foreign-schema guard', () => {
  it('dry-runs the whole module migration corpus', () => {
    expect(audit.migrations).toBeGreaterThan(250);
    expect(audit.statements).toBeGreaterThan(audit.migrations);
  });

  it('meets no refusal in up() beyond the R2 exemptions — every client can migrate', () => {
    expect(
      audit.findings
        .filter((finding) => finding.method === 'up')
        .map((finding) => `${finding.moduleId} ${finding.migration}.up() → ${finding.table}: ${finding.statement}`),
    ).toEqual([]);
  });

  /**
   * D-291 R-A6 — a migration may not destroy a table another module's entity
   * maps, in `down()` either, whatever it created; only a derived D-226 bridge
   * is exempt. What is left refused is exactly that: `down()`s that drop a
   * pre-split table or a column they once added to another module's table, so
   * a hard uninstall of those modules is refused in an instance rather than
   * destroying another module's schema.
   */
  it('refuses in down() only the destruction of a table another module maps, never a bridge', () => {
    const destructive = /^(drop\s+table|drop\s+index|truncate|alter\s+table\s+\S+\s.*\bdrop\b)/i;
    const left = audit.findings.filter((finding) => finding.method === 'down');
    expect(left.filter((finding) => !destructive.test(finding.statement))).toEqual([]);
    expect(left.some((finding) => finding.table === 'organization_warehouses')).toBe(false);
    expect(
      unexempted.findings.some(
        (finding) => finding.table === 'organization_warehouses' && finding.method === 'down',
      ),
    ).toBe(true);
  });

  it('refuses, without the exemptions, exactly the writes R2 records — the list is neither short nor stale', () => {
    const destructive = /^(drop\s+table|drop\s+index|truncate|alter\s+table\s+\S+\s.*\bdrop\b)/i;
    const refused = new Set(
      unexempted.findings
        .filter((finding) => finding.method === 'up' || !destructive.test(finding.statement))
        .map((finding) => `${finding.moduleId} ${finding.migration} ${finding.table}`),
    );
    const exempted = new Set(
      FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS.filter((row) => (row.kind ?? 'write') === 'write').map(
        (row) => `${row.moduleId} ${row.migration} ${row.table}`,
      ),
    );
    expect([...refused].sort()).toEqual([...exempted].sort());
  });

  it('dry-runs without a migration throwing', () => {
    expect(audit.dryRunErrors).toEqual([]);
  });
});
