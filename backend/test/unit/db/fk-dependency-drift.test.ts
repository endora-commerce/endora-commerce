import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveFkGraph } from '../../helpers/fk-graph.js';
import { TABLE_OWNER_OVERRIDES } from './table-owner-overrides.js';

/**
 * FK-vs-manifest drift validator — cases V1-V10 of
 * specs/065-manifest-aware-migrations/contracts/fk-dependency-check.md §5.
 *
 * Pure: no database, no ORM bootstrap. It validates the *input* the ordering
 * algorithm consumes; it has no runtime path and no effect on the emitted
 * migration order (FR-043).
 */

const here = dirname(fileURLToPath(import.meta.url));
const backendSrc = resolve(here, '../../../src');

const graph = deriveFkGraph(backendSrc, { overrides: TABLE_OWNER_OVERRIDES });

describe('fk ownership map — V2 exhaustiveness', () => {
  it('resolves an owner for every table any migration creates', () => {
    expect(
      graph.unownedTables,
      `these tables are created by a migration but claimed by no entity and no ` +
        `override — decide their owner in test/unit/db/table-owner-overrides.ts: ` +
        `${graph.unownedTables.join(', ')}`,
    ).toEqual([]);
  });

  it('resolves every referenced table', () => {
    expect(
      graph.unresolvedReferences,
      `these foreign keys point at a table with no resolvable owner: ` +
        `${graph.unresolvedReferences.join(', ')}`,
    ).toEqual([]);
  });

  it('carries no stale override key', () => {
    const stale = Object.keys(TABLE_OWNER_OVERRIDES).filter(
      (table) => !graph.createdTables.has(table) || graph.entityOwners.has(table),
    );
    expect(
      stale,
      `these TABLE_OWNER_OVERRIDES keys are no longer needed (the table is gone, ` +
        `or an entity now declares it): ${stale.join(', ')}`,
    ).toEqual([]);
  });
});

describe('fk ownership map — V10 core owns nothing', () => {
  it("never attributes a table to the 'core' pseudo-module", () => {
    const coreOwned = [...graph.owners.entries()]
      .filter(([, moduleId]) => moduleId === 'core')
      .map(([table]) => table);
    expect(
      coreOwned,
      `'core' is a migration-ownership pseudo-module and owns no table; these ` +
        `resolved to it: ${coreOwned.join(', ')}`,
    ).toEqual([]);
  });
});
