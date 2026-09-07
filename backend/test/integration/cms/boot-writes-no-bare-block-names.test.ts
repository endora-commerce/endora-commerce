import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanAllColumns } from '../../../../packages/modules/cms/src/backend/cli/block-names.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 096, T508 — **the test that catches a missed T501–T506.**
 *
 * The migration renames what is stored; it does not stop anything from writing
 * the old vocabulary again. Nine sources write Puck trees at boot or at runtime
 * — the e-mail defaults in `@endora-commerce/email-components`, the row-layout
 * presets, seven modules' `email-templates/*.default.ts`, two block seeders and
 * the generic invoice template — and **a single one of them left un-renamed
 * re-introduces bare names into a migrated database on every boot**, silently:
 * the block then renders as the missing-component placeholder, and the operator's
 * report says *will be renamed* on a database that has already been migrated.
 *
 * The rename being idempotent is what makes that survivable rather than
 * catastrophic, and it is also what makes it invisible — nothing fails.
 *
 * So this boots the platform against a migrated database, lets every boot
 * reconciler and seeder run, and asks the operator's own report the question:
 * **is any name in any of the eleven columns still bare?** It uses `scanAllColumns`
 * rather than a private walk because the report is the instrument an operator
 * would use to answer it, and two derivations of one population are two answers
 * waiting to disagree.
 *
 * A bare name from **any** source fails this, a leaked test fixture included.
 * That is deliberate: a fixture that writes the pre-migration vocabulary into a
 * shared table is worth knowing about for the same reason a seeder is.
 */
describe('a booted platform writes no bare block names (T508)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('leaves nothing in the eleven columns that the migration would rename', async () => {
    const findings = await scanAllColumns(h.em());
    const bare = findings
      .filter((f) => f.classification === 'will-be-renamed')
      .map((f) => `${f.table}.${f.column}: ${f.name} -> ${f.becomes} (${f.occurrences} nodes)`);
    expect(bare).toEqual([]);
  });

  it('read something — a scan that found no block name at all proves nothing', () => {
    // The seeded platform ships e-mail header and footer blocks, so a run that
    // classified zero names read an empty database and the assertion above was
    // vacuous.
    return scanAllColumns(h.em()).then((findings) => {
      expect(findings.length).toBeGreaterThan(0);
    });
  });
});
