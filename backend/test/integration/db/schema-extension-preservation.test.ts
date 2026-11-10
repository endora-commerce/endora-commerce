import { Migration } from '@mikro-orm/migrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rolledOutExtensibleHosts } from '@endora-commerce/platform/db';

import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import {
  HOST_TABLE,
  fixtureConfig,
  throwawayDatabase,
  type ThrowawayDatabase,
} from '../../helpers/schema-extension-fixture.js';
import { describeFindings, walkPreservation } from '../../helpers/schema-extension-preservation.js';

/**
 * `specs/178-extensible-columns/` FR-080, SC-003 (tasks.md T040,
 * `contracts/preservation-test.md`) — a core migration may not lose an
 * extension's `x_*` columns on an extensible table.
 *
 * The full core migration order is applied to an empty database one migration
 * at a time; every rolled-out extensible table is seeded with three fixture
 * elements right after the migration that creates it, and re-checked after
 * every later step. This is the post-merge half (`test:backend`, D-198);
 * `check:extensible-tables` is the merge-request half.
 *
 * The host set is the platform's own rolled-out list, read through the same
 * function the ORM configuration and the migration merge read, so Phase D's
 * removal of the rollout constant widens this test without an edit.
 *
 * Cost, measured on first run (2026-11-10, machine load ~40, one rolled-out
 * host): the full core walk took 30 s, against the contract's budget of 120 s
 * before switching to checkpoints at the creating migrations. A red run reports
 * its own step count and duration in the assertion message.
 */

/** A host release that rebuilds its table and drops what it does not know about. */
class Migration20261110T000002FixtureHostRebuild extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "x178_hosts_rebuilt" as select "id", "name" from "x178_hosts";`);
    this.addSql(`drop table "x178_hosts";`);
    this.addSql(`alter table "x178_hosts_rebuilt" rename to "x178_hosts";`);
  }
}

describe('preservation walk — red proof over a rebuilding host migration', () => {
  let db: ThrowawayDatabase;
  beforeAll(async () => {
    db = await throwawayDatabase('x178pres');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('names the table, the lost element and the migration that lost it', async () => {
    const report = await walkPreservation({
      url: db.url,
      config: fixtureConfig(db.url, [], { hostMigrations: [Migration20261110T000002FixtureHostRebuild] }),
      hosts: [HOST_TABLE],
    });
    expect(report.seededAfter.get(HOST_TABLE)).toBe('Migration20261110T000001FixtureHostInit');
    expect(report.findings.map((finding) => finding.element).sort()).toEqual([
      'column x_fixture_code',
      'column x_fixture_flag',
      'column x_fixture_note',
      `index ${HOST_TABLE}_x_fixture_code_uq`,
    ]);
    for (const finding of report.findings) {
      expect(finding).toMatchObject({
        table: HOST_TABLE,
        afterMigration: 'Migration20261110T000002FixtureHostRebuild',
      });
    }
  }, 120_000);
});

describe('preservation walk — the core migration order over the rolled-out hosts', () => {
  let db: ThrowawayDatabase;
  beforeAll(async () => {
    db = await throwawayDatabase('x178pres');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('keeps every fixture column and index on every rolled-out extensible table', async () => {
    const hosts = [...rolledOutExtensibleHosts().keys()];
    expect(hosts.length, 'no extensible host is rolled out, so this walk would prove nothing').toBeGreaterThan(0);

    const report = await walkPreservation({ url: db.url, config: await mikroOrmConfig(), hosts });

    expect([...report.seededAfter.keys()].sort(), 'an extensible table was never created by the order').toEqual(
      [...hosts].sort(),
    );
    expect(
      report.findings,
      `${describeFindings(report.findings)}\n(${report.steps} migrations in ${report.elapsedMs} ms)`,
    ).toEqual([]);
  }, 600_000);
});
