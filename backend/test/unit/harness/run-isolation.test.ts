import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TEST_DATABASE_NAME_PATTERN,
  isolationMode,
  keepRunDatabase,
  parseRunDatabaseName,
  redisUrlWithDatabase,
  runDatabaseName,
  sharedDatabaseReason,
  strandedRunDatabases,
  templateDatabaseName,
  templateDrift,
  withDatabase,
} from '../../run-isolation.js';
import { TEST_DATABASE_NAME_PATTERN as SEED_GUARD_PATTERN } from '../../../src/seeds/dev-seed-guard.js';

/**
 * Issue #189 — the naming and selection rules behind per-invocation isolation.
 *
 * Everything here is pure: no database, no Redis, so it runs in the fast unit
 * job. The two properties that carry the safety of the whole design are the
 * first two — a generated name must satisfy the *existing* guard (nothing about
 * it is loosened), and a foreign database must never be selected for a drop.
 */

const BASE = 'b2b_test';
const AT = new Date('2026-08-19T12:00:00.000Z');

describe('run-isolation — generated database names', () => {
  it('produces a run name the existing test-database guard accepts', () => {
    const name = runDatabaseName(BASE, AT, 'a1b2c3');
    expect(name).toMatch(TEST_DATABASE_NAME_PATTERN);
    // The same judgement `src/seeds/dev-seed-guard.ts` makes, from its own
    // export rather than from a second copy of the regex.
    expect(name).toMatch(SEED_GUARD_PATTERN);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it('produces a template name the existing guard accepts', () => {
    const name = templateDatabaseName(BASE);
    expect(name).toMatch(TEST_DATABASE_NAME_PATTERN);
    expect(name).toMatch(SEED_GUARD_PATTERN);
    expect(name).not.toBe(BASE);
  });

  it('refuses a base whose derived name would not be a test database', () => {
    // `b2b` is the dev database. Deriving from it must throw rather than
    // produce `b2b_r_...`, which the guard would reject anyway — the point is
    // that the refusal happens where the name is made.
    expect(() => runDatabaseName('b2b', AT, 'a1b2c3')).toThrow(/test database/i);
    expect(() => templateDatabaseName('b2b')).toThrow(/test database/i);
  });

  it('refuses a base that would overflow the 63-byte identifier limit', () => {
    const long = `${'x'.repeat(60)}_test`;
    expect(() => runDatabaseName(long, AT, 'a1b2c3')).toThrow(/63/);
  });

  it('refuses a base carrying anything but letters, digits and underscores', () => {
    expect(() => runDatabaseName('b2b_test"; drop database b2b; --', AT, 'a1b2c3')).toThrow(
      /unsafe/i,
    );
  });

  it('round-trips the creation instant it embeds', () => {
    const name = runDatabaseName(BASE, AT, 'a1b2c3');
    const parsed = parseRunDatabaseName(BASE, name);
    expect(parsed).toBeDefined();
    // Second precision — the name carries epoch seconds, not milliseconds.
    expect(parsed?.createdAt.getTime()).toBe(Math.floor(AT.getTime() / 1000) * 1000);
  });

  it('does not recognise a database this harness did not create', () => {
    // The three shapes actually standing on the developer machine that
    // reported #189: the base itself, the dev database, and the hand-named
    // escape-hatch databases agents created one per task.
    for (const foreign of ['b2b_test', 'b2b', 'b2b_test_a112', 'b2b_integration_test']) {
      expect(parseRunDatabaseName(BASE, foreign)).toBeUndefined();
    }
  });
});

describe('run-isolation — sweeping stranded run databases', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');
  const hoursAgo = (h: number): Date => new Date(now.getTime() - h * 3600_000);
  const old = runDatabaseName(BASE, hoursAgo(9), 'aaaaaa');
  const recent = runDatabaseName(BASE, hoursAgo(1), 'bbbbbb');
  const mine = runDatabaseName(BASE, hoursAgo(8), 'cccccc');
  const busyButOld = runDatabaseName(BASE, hoursAgo(7), 'dddddd');

  it('selects only names this harness generated, old enough, and unconnected', () => {
    const stranded = strandedRunDatabases({
      base: BASE,
      names: [old, recent, mine, busyButOld, 'b2b', 'b2b_test', 'b2b_test_a112'],
      busy: new Set([busyButOld]),
      keep: mine,
      now,
      maxAgeMs: 4 * 3600_000,
      limit: 25,
    });
    expect(stranded).toEqual([old]);
  });

  it('never selects a database outside the generated pattern, however old', () => {
    const stranded = strandedRunDatabases({
      base: BASE,
      names: ['b2b', 'b2b_test', 'b2b_test_a112', 'b2b_078_test'],
      busy: new Set(),
      keep: '',
      now,
      maxAgeMs: 0,
      limit: 25,
    });
    expect(stranded).toEqual([]);
  });

  it('caps how many it drops in one invocation', () => {
    const names = Array.from({ length: 40 }, (_, i) =>
      runDatabaseName(BASE, hoursAgo(9), i.toString(16).padStart(6, '0')),
    );
    expect(
      strandedRunDatabases({
        base: BASE,
        names,
        busy: new Set(),
        keep: '',
        now,
        maxAgeMs: 4 * 3600_000,
        limit: 25,
      }),
    ).toHaveLength(25);
  });
});

describe('run-isolation — URLs', () => {
  it('swaps the database name and keeps everything else about the DSN', () => {
    expect(withDatabase('postgresql://b2b:b2b@postgres:5432/b2b_test', 'b2b_test_tpl')).toBe(
      'postgresql://b2b:b2b@postgres:5432/b2b_test_tpl',
    );
  });

  it('points a Redis DSN at a logical database index', () => {
    expect(redisUrlWithDatabase('redis://localhost:6379', 7)).toBe('redis://localhost:6379/7');
    expect(redisUrlWithDatabase('rediss://user:pw@redis:6380/0', 3)).toBe(
      'rediss://user:pw@redis:6380/3',
    );
  });
});

describe('run-isolation — the mode', () => {
  it('isolates by default, so nobody has to know it exists', () => {
    expect(isolationMode({})).toBe('per-invocation');
  });

  it('can be turned off explicitly, for a run whose database you want to inspect', () => {
    expect(isolationMode({ BACKEND_TEST_ISOLATION: 'shared' })).toBe('shared');
  });

  it('refuses a value it does not know rather than guessing', () => {
    expect(() => isolationMode({ BACKEND_TEST_ISOLATION: 'maybe' })).toThrow(
      /BACKEND_TEST_ISOLATION/,
    );
  });
});

describe('run-isolation — when a run shares the base database instead', () => {
  it('does not, by default', () => {
    expect(sharedDatabaseReason({}, BASE)).toBeUndefined();
  });

  it('does when the mode says so', () => {
    expect(sharedDatabaseReason({ BACKEND_TEST_ISOLATION: 'shared' }, BASE)).toBe('explicit');
  });

  it('does when somebody overrode the test-database guard', () => {
    // `ALLOW_NON_TEST_DATABASE_URL` is a person deliberately pointing the suite
    // at a database whose name breaks the convention. A name derived from it
    // would break it too, and isolation may not widen that judgement — so it
    // stands down rather than throwing at somebody who already said they know.
    expect(sharedDatabaseReason({}, 'scratch')).toBe('name-override');
  });
});

describe('run-isolation — keeping the run database', () => {
  it('drops it unless asked, and reads the ask the way a shell writes one', () => {
    expect(keepRunDatabase({})).toBe(false);
    expect(keepRunDatabase({ BACKEND_TEST_KEEP_DATABASE: '' })).toBe(false);
    expect(keepRunDatabase({ BACKEND_TEST_KEEP_DATABASE: '0' })).toBe(false);
    expect(keepRunDatabase({ BACKEND_TEST_KEEP_DATABASE: 'false' })).toBe(false);
    expect(keepRunDatabase({ BACKEND_TEST_KEEP_DATABASE: '1' })).toBe(true);
  });
});

describe('the test-database convention', () => {
  it('is spelled once, and `global-setup.ts` reads it from here', () => {
    // `test/unit/seeds/dev-seed-guard.test.ts` pins the seed guard's copy to
    // this module's. This half pins the harness's: `global-setup.ts` must
    // import the predicate rather than re-spell the regex, which is what it
    // used to do.
    const globalSetup = readFileSync(
      fileURLToPath(new URL('../../global-setup.ts', import.meta.url)),
      'utf8',
    );
    expect(globalSetup).toMatch(/from '\.\/run-isolation\.js'/);
    expect(globalSetup).not.toMatch(/\/\(\^\|_\)test\(_\|\$\)\//);
  });
});

describe('run-isolation — the migration template a run is cloned from', () => {
  const EXPECTED = ['MigrationA', 'MigrationB', 'MigrationC'] as const;

  it('accepts a template `migrator.up()` can bring forward on its own', () => {
    // Applied-in-order is the only shape an append can complete: `up()` puts
    // the pending ones after what is there, so the result is EXPECTED exactly.
    expect(templateDrift([], EXPECTED)).toBeUndefined();
    expect(templateDrift(['MigrationA'], EXPECTED)).toBeUndefined();
    expect(templateDrift(['MigrationA', 'MigrationB'], EXPECTED)).toBeUndefined();
    expect(templateDrift([...EXPECTED], EXPECTED)).toBeUndefined();
  });

  it('reports a migration this run has never heard of', () => {
    // A template is shared by every branch on the machine. Another branch's
    // migration is applied here, and `up()` can neither revert it nor place it.
    const drift = templateDrift(['MigrationA', 'MigrationFromAnotherBranch'], EXPECTED);
    expect(drift?.kind).toBe('unknown-migration');
    expect(drift?.name).toBe('MigrationFromAnotherBranch');
    expect(drift?.message).toContain('MigrationFromAnotherBranch');
  });

  it('reports one of this run\'s own migrations applied out of order', () => {
    // The shape that broke `attributes-migration-parity.test.ts`: a migration
    // added in the middle of the module graph's order lands at the end of an
    // incrementally-migrated template, so the applied order is one this
    // repository's migrations never produce from scratch.
    const drift = templateDrift(['MigrationA', 'MigrationC', 'MigrationB'], EXPECTED);
    expect(drift?.kind).toBe('out-of-order');
    expect(drift?.name).toBe('MigrationC');
    expect(drift?.expected).toBe('MigrationB');
  });

  it('reports a hole, which an append can never fill', () => {
    const drift = templateDrift(['MigrationA', 'MigrationC'], EXPECTED);
    expect(drift?.kind).toBe('out-of-order');
    expect(drift?.name).toBe('MigrationC');
    expect(drift?.expected).toBe('MigrationB');
  });

  it('says which template it is judging, so the log line stands alone', () => {
    const drift = templateDrift(['MigrationZ'], EXPECTED, 'b2b_test_tpl');
    expect(drift?.message).toContain('b2b_test_tpl');
  });
});
