/**
 * Issue #224 — the dev seed's "is this a local database" guard.
 *
 * The seed truncates the public catalog and business tables, so `DATABASE_URL`
 * pointing anywhere but a disposable database has to be refused. It was not:
 * the shipped test was a regex over the whole DSN with `postgres` as one of its
 * alternatives, and every PostgreSQL DSN starts `postgresql://`. The first test
 * below is the proof, and it is kept as the reason this file exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  mustBeNonProduction,
  TEST_DATABASE_NAME_PATTERN,
} from '../../../src/seeds/dev-seed-guard.js';

const DEV_LOCAL = 'postgresql://b2b:b2b@localhost:5432/b2b';
const DEV_COMPOSE = 'postgresql://b2b:b2b@postgres:5432/b2b';
const CI_COMPOSE = 'postgresql://b2b:b2b@postgres:5432/b2b_test';
const PROD_HOSTNAME = 'postgresql://user:pw@db.production.example.com:5432/shop';
const PROD_IP = 'postgresql://u:p@10.0.0.5:5432/prod';

/** The whole environment the guard reads, so no test inherits the real one. */
function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe('the regex this guard replaced', () => {
  it('accepted every production DSN, so it never refused anything', () => {
    // Verbatim from `dev-catalog-seed.ts:200` before this fix.
    const shipped = /localhost|127\.0\.0\.1|postgres(?::\d+)?/;

    // Intended to match the docker-compose service hostname...
    expect(shipped.test(DEV_COMPOSE)).toBe(true);
    // ...but `postgres` is a substring of the `postgresql://` scheme, so:
    expect(shipped.test(PROD_HOSTNAME)).toBe(true);
    expect(shipped.test(PROD_IP)).toBe(true);
    // There is no PostgreSQL DSN it can refuse: the scheme carries the match.
    expect(shipped.test('postgresql://anything/at/all')).toBe(true);
  });
});

describe('mustBeNonProduction — the database the seed is pointed at', () => {
  it('allows a loopback host whatever the database is called', () => {
    expect(() => mustBeNonProduction(env({ DATABASE_URL: DEV_LOCAL }))).not.toThrow();
    expect(() =>
      mustBeNonProduction(env({ DATABASE_URL: 'postgresql://b2b:b2b@127.0.0.1:5432/b2b' })),
    ).not.toThrow();
    expect(() =>
      mustBeNonProduction(env({ DATABASE_URL: 'postgresql://b2b:b2b@[::1]:5432/b2b' })),
    ).not.toThrow();
  });

  it('allows the dev default when DATABASE_URL is unset', () => {
    expect(() => mustBeNonProduction(env())).not.toThrow();
  });

  it('refuses a remote host', () => {
    expect(() => mustBeNonProduction(env({ DATABASE_URL: PROD_HOSTNAME }))).toThrow(
      /refusing to run dev-catalog-seed/,
    );
    expect(() => mustBeNonProduction(env({ DATABASE_URL: PROD_IP }))).toThrow(
      /refusing to run dev-catalog-seed/,
    );
  });

  it('refuses the docker-compose service hostname with a production database name', () => {
    // `postgres` is the service name in BOTH docker-compose.yml and
    // deploy/compose.prod.yml, so the host alone cannot separate them.
    expect(() => mustBeNonProduction(env({ DATABASE_URL: DEV_COMPOSE }))).toThrow(
      /refusing to run dev-catalog-seed/,
    );
  });

  it('allows the compose service hostname when the database name says it is a test database', () => {
    // The CI shape: same host, `b2b_test` — the convention test/global-setup.ts
    // already uses to decide a database is safe to wipe.
    expect(() => mustBeNonProduction(env({ DATABASE_URL: CI_COMPOSE }))).not.toThrow();
  });

  it('refuses a malformed DSN instead of throwing an unhandled parse error', () => {
    let thrown: unknown;
    try {
      mustBeNonProduction(env({ DATABASE_URL: 'not a dsn' }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/refusing to run dev-catalog-seed/);
    expect((thrown as Error).message).not.toMatch(/Invalid URL/);
  });

  it('refuses a DSN with no host (unix socket) unless the database name says test', () => {
    expect(() =>
      mustBeNonProduction(env({ DATABASE_URL: 'postgresql:///b2b?host=/var/run/postgresql' })),
    ).toThrow(/refusing to run dev-catalog-seed/);
    expect(() =>
      mustBeNonProduction(env({ DATABASE_URL: 'postgresql:///b2b_test?host=/var/run/postgresql' })),
    ).not.toThrow();
  });

  it('does not print the DSN credentials in the refusal', () => {
    let message = '';
    try {
      mustBeNonProduction(env({ DATABASE_URL: 'postgresql://admin:s3cret@db.example.com/shop' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('db.example.com');
    expect(message).toContain('shop');
    expect(message).not.toContain('s3cret');
  });

  it('accepts an explicit, separately-named override', () => {
    expect(() =>
      mustBeNonProduction(
        env({
          DATABASE_URL: PROD_HOSTNAME,
          ALLOW_DEV_SEED_ON_NON_LOCAL_DATABASE: 'true',
        }),
      ),
    ).not.toThrow();
  });
});

describe('mustBeNonProduction — NODE_ENV', () => {
  it('refuses NODE_ENV=production', () => {
    expect(() =>
      mustBeNonProduction(env({ NODE_ENV: 'production', DATABASE_URL: DEV_LOCAL })),
    ).toThrow(/NODE_ENV=production/);
  });

  it('lets ALLOW_DEV_SEED_IN_PRODUCTION past that check only', () => {
    expect(() =>
      mustBeNonProduction(
        env({
          NODE_ENV: 'production',
          ALLOW_DEV_SEED_IN_PRODUCTION: 'true',
          DATABASE_URL: DEV_LOCAL,
        }),
      ),
    ).not.toThrow();
  });

  it('keeps the two guards independent — the production flag does not unlock a production DSN', () => {
    // This is the whole point of issue #224: one flag must not answer for both
    // questions, because for two years the second question answered "yes" to
    // everything and NODE_ENV was the only real protection.
    expect(() =>
      mustBeNonProduction(
        env({
          NODE_ENV: 'production',
          ALLOW_DEV_SEED_IN_PRODUCTION: 'true',
          DATABASE_URL: DEV_COMPOSE,
        }),
      ),
    ).toThrow(/refusing to run dev-catalog-seed/);
  });
});

describe('the test-database convention', () => {
  it('is the same one the vitest harness uses to decide a database is safe to wipe', () => {
    const globalSetup = readFileSync(
      fileURLToPath(new URL('../../global-setup.ts', import.meta.url)),
      'utf8',
    );
    const harnessPattern = /const looksLikeTest = (\/.*\/)\.test\(dbName\)/.exec(globalSetup)?.[1];
    expect(
      harnessPattern,
      'test/global-setup.ts no longer spells its test-database check the way this test reads it',
    ).toBeTruthy();
    expect(`/${TEST_DATABASE_NAME_PATTERN.source}/`).toBe(harnessPattern);
  });
});
