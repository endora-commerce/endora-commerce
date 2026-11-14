import { describe, expect, it } from 'vitest';
import { FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS } from '@endora-commerce/platform/migrations';

import {
  bridgeEntriesOf,
  firstPartyBridges,
  firstPartyDerivedDowns,
} from '../../../scripts/lib/first-party-bridges.js';

/**
 * `specs/178-extensible-columns/` D-291 R-A6 (tasks.md T071) — the only
 * exemption from "a package may not destroy another module's table" is a
 * first-party D-226 bridge, **derived**: a module W's migration creates a table
 * another module O's entity maps, O is in W's dependency closure, and the table
 * references both a table of W and a table of O. `composer:generate` renders the
 * entries; the artefact holds exactly the derivation (two-way).
 */
describe('first-party D-226 bridges', () => {
  it('derives inventory’s organization_warehouses bridge, reverted in down()', async () => {
    expect(await firstPartyBridges()).toContainEqual({
      moduleId: 'inventory',
      migration: 'Migration20260912T125716InventoryOrganizationWarehouses',
      table: 'organization_warehouses',
      kind: 'bridge',
      direction: 'down',
    });
  });

  it('the generated exemption artefact holds exactly the derived bridges', async () => {
    const rendered = FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS.filter((row) => (row as { kind?: string }).kind === 'bridge');
    expect([...rendered].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
      (await firstPartyBridges()).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
  });

  it('is not a pre-split init: a table referencing only its owner’s side is no bridge', () => {
    const owners = new Map([
      ['promotions', 'promotions'],
      ['taxes', 'taxes'],
      ['organizations', 'organizations'],
      ['warehouses', 'inventory'],
      ['organization_warehouses', 'organizations'],
    ]);
    const file = (body: string, down: string) =>
      `export class Migration20260101T000000XInit extends Migration {\n  override async up() { this.addSql(\`${body}\`); }\n` +
      `  override async down() { this.addSql(\`${down}\`); }\n}\n`;
    const closure = new Map([['taxes', new Set(['promotions'])], ['inventory', new Set(['organizations'])]]);
    expect(
      bridgeEntriesOf(
        'taxes',
        file('create table "promotions" ("id" uuid primary key)', 'drop table "promotions"'),
        owners,
        closure,
      ),
    ).toEqual([]);
    expect(
      bridgeEntriesOf(
        'inventory',
        file(
          'create table if not exists "organization_warehouses" ("o" uuid references "organizations" ("id"), "w" uuid references "warehouses" ("id"))',
          'drop table if exists "organization_warehouses" cascade',
        ),
        owners,
        closure,
      ).map((entry) => entry.direction),
    ).toEqual(['down']);
  });
});

/**
 * D-291 R-A7 (T072) — the `derived-down` entries: every first-party `down()`
 * destruction of a table another module owns that R-A7's predicate exempts,
 * with the clause that exempts it. Two-way against the artefact.
 */
describe('first-party derived-down exemptions', () => {
  const sort = <T>(rows: readonly T[]): T[] => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  it('the generated artefact holds exactly the derived entries', async () => {
    const rendered = FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS.filter((row) => row.kind === 'derived-down');
    expect(sort(rendered)).toEqual(sort(await firstPartyDerivedDowns()));
  });

  it('records the clause, and names the sites the ruling measured', async () => {
    const derived = await firstPartyDerivedDowns();
    const at = (moduleId: string, table: string) => derived.find((row) => row.moduleId === moduleId && row.table === table)?.clause;
    expect(at('taxes', 'promotions')).toBe('owner-depends-on-writer');
    // `dictionaries -> languages` named this clause until issue #611 moved those statements to
    // `languages`; the `currencies` half of the same `down()` still stands.
    expect(at('dictionaries', 'currencies')).toBe('both-required');
    expect(derived.some((row) => row.moduleId === 'quote_requests')).toBe(false);
  });
});

