/**
 * Per-invocation test isolation (issue #189).
 *
 * ## The defect
 *
 * Isolation in this suite is **per database and per Redis instance**, not per
 * invocation. `helpers/test-server.ts` truncates `SEEDED_TABLES`, composes a
 * server and seeds fixtures on every booting file, so a second `vitest run`
 * against the same `b2b_test` lands its truncate in the middle of the first
 * one's setup. Three agents hit that in one day and every one of them read it
 * as a real failure first: `Hook timed out in 30000ms` in `beforeAll`, then
 * `Cannot read properties of undefined (reading 'app')` in the teardown that
 * never got a handle; a shifting subset of one directory failing with 403s and
 * missing fixtures, a different subset each run; and a role created through the
 * API reading back `null` because another invocation had truncated
 * `admin_roles` between the write and the read.
 *
 * The cost is not the flakes. It is that a false failure is indistinguishable
 * from a true one, so the failure is either chased for an hour or — worse —
 * dismissed as "probably the shared database" when it is real.
 *
 * ## The answer
 *
 * A run gets its **own** database and its **own** Redis logical database,
 * automatically. The escape hatch already existed and was manual — every agent
 * that got clean results set `TEST_DATABASE_URL=…/b2b_<something>_test` by hand
 * — so this makes the thing that already worked the default rather than a thing
 * you have to know. (156 hand-named test databases were standing on the
 * developer machine that reported this, 4.1 GB of them, which is the other half
 * of what "manual" costs.)
 *
 * **Per invocation, not per file.** The harness's per-file cost already
 * dominates the suite (issue #72: a truncate is 1149 ms per composition), so a
 * fresh database per *file* would be unaffordable. Per invocation is the
 * granularity the defect actually has.
 *
 * **Cloned, not migrated.** `<base>_tpl` is the migrated template — created and
 * brought up to date once, under an advisory lock so concurrent invocations
 * cannot race on it — and each run is `create database … template <base>_tpl`,
 * which is a file copy: 0.2 s warm against the 39 MB this schema occupies.
 * Nothing about the migration coverage changes: the template is still migrated
 * from scratch on a fresh cluster, which is what the CI job's comment about
 * exercising the whole chain is protecting.
 *
 * **Names satisfy the existing guard.** `runDatabaseName` refuses to produce a
 * name `TEST_DATABASE_NAME_PATTERN` would not accept, so the harness's refusal
 * to truncate a non-test database is untouched — not loosened, not bypassed.
 * That predicate lives here now and `global-setup.ts` imports it, so there is
 * one spelling of it rather than three.
 *
 * **Redis by logical database index, not by key prefix.** Every Redis client in
 * this tree — 8 in `src/`, 40-odd in `test/` — is built as
 * `new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379')`, and
 * ioredis reads the index off the DSN path. Pointing `REDIS_URL` at
 * `…/<index>` therefore isolates all of them, including BullMQ, with no call
 * site changed. A key prefix would have to be threaded through every one of
 * those constructions, and `keys(pattern)` — which `dropStaleCaches` uses — is
 * not a key-taking command as far as ioredis is concerned, so a prefixed client
 * would still scan and delete another run's keys.
 *
 * ## Cleanup
 *
 * The run database is dropped by `global-setup.ts`'s teardown. A **crashed**
 * run cannot run its teardown, so every invocation also sweeps: run databases
 * carry their creation instant in their name, and one older than
 * `STALE_RUN_DATABASE_MS` with no connection to it is dropped, at most
 * `SWEEP_LIMIT` per invocation. Only names this module generated are ever
 * considered — the 156 hand-named databases and anything else on the cluster
 * are outside the pattern by construction, and `strandedRunDatabases` is
 * unit-tested on exactly that. Redis leases expire on their own TTL.
 */

import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * A database name that says "this database exists to be wiped".
 *
 * The one spelling of the judgement. `global-setup.ts` imports it before it
 * lets a run truncate anything, `runDatabaseName` refuses to emit a name that
 * fails it, and `src/seeds/dev-seed-guard.ts` keeps its own copy pinned to this
 * one by `test/unit/seeds/dev-seed-guard.test.ts` (it is `src/`, so it cannot
 * import from `test/`).
 */
export const TEST_DATABASE_NAME_PATTERN = /(^|_)test(_|$)/;

/** PostgreSQL identifiers are 63 bytes; a longer name is silently truncated. */
const MAX_IDENTIFIER_LENGTH = 63;

/** What separates the base name from the run token. */
const RUN_INFIX = '_r_';

/** The migrated database every run is cloned from. Nothing runs tests against it. */
const TEMPLATE_SUFFIX = '_tpl';

/** How old a run database must be before a sweep may take it for stranded. */
export const STALE_RUN_DATABASE_MS = 4 * 60 * 60 * 1000;

/** How many stranded databases one invocation drops, so a sweep cannot become the run's cost. */
export const SWEEP_LIMIT = 25;

/** The environment variable that turns per-invocation isolation off. */
export const ISOLATION_ENV = 'BACKEND_TEST_ISOLATION';

/** Set this to keep the run database after the run, for a post-mortem. */
export const KEEP_DATABASE_ENV = 'BACKEND_TEST_KEEP_DATABASE';

export type IsolationMode = 'per-invocation' | 'shared';

export function isolationMode(env: NodeJS.ProcessEnv = process.env): IsolationMode {
  const raw = env[ISOLATION_ENV]?.trim();
  if (raw === undefined || raw === '') return 'per-invocation';
  if (raw === 'per-invocation' || raw === 'shared') return raw;
  throw new Error(
    `${ISOLATION_ENV} must be "per-invocation" or "shared" (got "${raw}"). ` +
      `"shared" is the pre-#189 behaviour: every invocation on one database.`,
  );
}

function assertSafeIdentifier(name: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `unsafe database name "${name}" — a generated name is interpolated into ` +
        `CREATE/DROP DATABASE, which cannot parameterise it.`,
    );
  }
}

function assertUsableDatabaseName(name: string): string {
  assertSafeIdentifier(name);
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(
      `generated database name "${name}" is ${name.length} bytes; PostgreSQL truncates ` +
        `identifiers at ${MAX_IDENTIFIER_LENGTH}, and a truncated name would collide with ` +
        `another run's. Shorten the base name in TEST_DATABASE_URL.`,
    );
  }
  if (!TEST_DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(
      `generated database name "${name}" is not a test database by the convention ` +
        `test/global-setup.ts enforces before it truncates. Isolation may not widen that ` +
        `judgement — point TEST_DATABASE_URL at a database whose name carries "test".`,
    );
  }
  return name;
}

/** The migrated source every run of this base is cloned from. */
export function templateDatabaseName(base: string): string {
  assertSafeIdentifier(base);
  return assertUsableDatabaseName(`${base}${TEMPLATE_SUFFIX}`);
}

export function randomRunToken(): string {
  return randomBytes(3).toString('hex');
}

/**
 * `<base>_r_<epoch-seconds base36>_<6 hex>`.
 *
 * The instant is in the name because `pg_database` has no creation timestamp
 * and the sweep needs an age. The random tail is what makes two invocations
 * starting in the same second distinct.
 */
export function runDatabaseName(
  base: string,
  createdAt: Date = new Date(),
  token: string = randomRunToken(),
): string {
  assertSafeIdentifier(base);
  const stamp = Math.floor(createdAt.getTime() / 1000).toString(36);
  return assertUsableDatabaseName(`${base}${RUN_INFIX}${stamp}_${token}`);
}

export function parseRunDatabaseName(
  base: string,
  name: string,
): { readonly createdAt: Date } | undefined {
  if (!/^[A-Za-z0-9_]+$/.test(base)) return undefined;
  const match = new RegExp(`^${base}${RUN_INFIX}([0-9a-z]+)_([0-9a-f]{6})$`).exec(name);
  if (!match) return undefined;
  const seconds = Number.parseInt(match[1] as string, 36);
  if (!Number.isFinite(seconds)) return undefined;
  return { createdAt: new Date(seconds * 1000) };
}

export interface StrandedSelection {
  readonly base: string;
  /** Every database name on the cluster. */
  readonly names: readonly string[];
  /** Names with at least one session connected, from `pg_stat_activity`. */
  readonly busy: ReadonlySet<string>;
  /** This invocation's own database, which is never stranded. */
  readonly keep: string;
  readonly now: Date;
  readonly maxAgeMs: number;
  readonly limit: number;
}

/**
 * The stranded run databases a sweep may drop.
 *
 * Three conditions, and each one is load-bearing: the name is one this module
 * generated (so no foreign database is ever a candidate), it is older than the
 * threshold (so a live run is not taken for a corpse — the complete suite takes
 * the better part of an hour), and nothing is connected to it right now (a
 * booting file closes the ORM between files, so idleness alone would not be
 * enough, which is why it is `and` rather than `or`).
 */
export function strandedRunDatabases(input: StrandedSelection): string[] {
  const selected: string[] = [];
  for (const name of input.names) {
    if (selected.length >= input.limit) break;
    if (name === input.keep) continue;
    if (input.busy.has(name)) continue;
    const parsed = parseRunDatabaseName(input.base, name);
    if (!parsed) continue;
    if (input.now.getTime() - parsed.createdAt.getTime() < input.maxAgeMs) continue;
    selected.push(name);
  }
  return selected;
}

/** The same DSN, pointed at another database on the same server. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
}

/** The same Redis DSN, pointed at a logical database index. */
export function redisUrlWithDatabase(url: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`redis database index must be a non-negative integer (got ${index})`);
  }
  const parsed = new URL(url);
  parsed.pathname = `/${index}`;
  return parsed.toString();
}

/** Whether a Redis DSN already names a logical database — an explicit choice this module leaves alone. */
export function redisUrlNamesDatabase(url: string): boolean {
  const path = new URL(url).pathname.replace(/^\//, '');
  return path !== '' && /^\d+$/.test(path);
}

/** Identifies this invocation in a Redis lease and in the log lines. */
export function runIdentity(): string {
  return `${hostname()}:${process.pid}:${randomRunToken()}`;
}

/**
 * A 32-bit key for `pg_advisory_lock`, derived from the template name so two
 * bases do not serialize against each other. FNV-1a, folded into a signed int.
 */
export function advisoryLockKey(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
