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
 * **And it is the template of this run's migration set, not the machine's.**
 * `<base>_tpl_<digest>` (issue #289): the digest covers the ordered migration
 * class names *and* the content of every file that writes into a template, so
 * two branches that differ anywhere a template can see get two templates, and
 * two trees that agree share one and migrate once between them. Before that
 * there was one `<base>_tpl` and a check comparing applied migration *names*
 * against the configured order — which catches a branch that added a migration
 * and cannot catch one that changed what a migration of the same name does.
 * See `templateDigest`. What the name claims is checked against the template's
 * own provenance comment and against `mikro_orm_migrations` before anything is
 * cloned; a template that cannot account for itself is rebuilt, never used.
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
 *
 * **Templates are collected too**, and have to be: one per migration set means
 * one left behind whenever a branch gains a migration or is rebased.
 * `staleTemplates` is the other half of the bargain keying them made — same
 * three conditions, with the age read from the template's provenance rather
 * than from its name, because what matters about a template is when it was last
 * *used*.
 */

import { createHash, randomBytes } from 'node:crypto';
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

/**
 * The migrated database a run is cloned from. Nothing runs tests against it.
 *
 * The suffix is followed by the migration set's digest — see `templateDigest`.
 * The bare `<base>_tpl` was the pre-#289 name and is nobody's template now.
 */
const TEMPLATE_SUFFIX = '_tpl';

/** How many hex characters of the digest a template name carries. */
export const TEMPLATE_DIGEST_LENGTH = 12;

/** How old a run database must be before a sweep may take it for stranded. */
export const STALE_RUN_DATABASE_MS = 4 * 60 * 60 * 1000;

/**
 * How long a template survives with nothing using it.
 *
 * Templates are keyed by the migration set, so a branch that adds a migration
 * leaves the previous set's template behind the moment it is rebased or merged.
 * A day of nobody asking for a set is the point at which keeping its 19 MB
 * costs more than the one migration pass rebuilding it would.
 */
export const STALE_TEMPLATE_MS = 24 * 60 * 60 * 1000;

/** How many stranded databases one invocation drops, so a sweep cannot become the run's cost. */
export const SWEEP_LIMIT = 25;

/** The environment variable that turns per-invocation isolation off. */
export const ISOLATION_ENV = 'BACKEND_TEST_ISOLATION';

/** Set this to keep the run database after the run, for a post-mortem. */
export const KEEP_DATABASE_ENV = 'BACKEND_TEST_KEEP_DATABASE';

/**
 * The base DSN, exported to the workers by `global-setup.ts` on the isolated
 * path only.
 *
 * Its **presence is the statement** "this invocation has a migrated template,
 * and a file that needs a database of its own may clone it" — which is what
 * `setupMigratorTestDb` asks. Nothing derives it from the run database's name:
 * a run database is `<base>_r_<stamp>_<token>` and taking the base back out of
 * one would be a second, weaker spelling of `runDatabaseName`.
 */
export const BASE_DATABASE_URL_ENV = 'BACKEND_TEST_BASE_URL';

/**
 * The template this run was cloned from, exported to the workers alongside it.
 *
 * A name and not a derivation, because since #289 there is more than one
 * template on the cluster and which one is this run's is a fact about the run,
 * not about the base: another invocation may build a template of its own while
 * this one is still going, and a file that re-derived "the template" mid-run
 * would clone whichever set happened to be newest.
 */
export const TEMPLATE_DATABASE_ENV = 'BACKEND_TEST_TEMPLATE';

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

/**
 * Why this run is sharing the base database rather than taking one of its own,
 * or `undefined` when it is not.
 */
export function sharedDatabaseReason(
  env: NodeJS.ProcessEnv,
  baseName: string,
): 'explicit' | 'name-override' | undefined {
  if (isolationMode(env) === 'shared') return 'explicit';
  if (!TEST_DATABASE_NAME_PATTERN.test(baseName)) return 'name-override';
  return undefined;
}

/** Whether this run keeps its database for a post-mortem instead of dropping it. */
export function keepRunDatabase(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[KEEP_DATABASE_ENV]?.trim();
  return raw !== undefined && raw !== '' && raw !== '0' && raw !== 'false';
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

/**
 * The migrated source every run of *this migration set* is cloned from.
 *
 * The digest is in the name because that is what makes two different migration
 * sets two different databases: a template is shared exactly by the runs whose
 * platform it actually is, and never by the runs that merely share a cluster
 * with it. See `templateDigest` for what "the same set" means, and issue #289
 * for what one shared `<base>_tpl` cost.
 */
export function templateDatabaseName(base: string, digest: string): string {
  assertSafeIdentifier(base);
  if (!new RegExp(`^[0-9a-f]{${TEMPLATE_DIGEST_LENGTH}}$`).test(digest)) {
    throw new Error(
      `"${digest}" is not a migration-set digest — expected ${TEMPLATE_DIGEST_LENGTH} hex ` +
        `characters from templateDigest(). A template whose name does not carry its identity ` +
        `is the one issue #289 is about.`,
    );
  }
  return assertUsableDatabaseName(`${base}${TEMPLATE_SUFFIX}_${digest}`);
}

/**
 * The lock every invocation of this base takes before it touches a template.
 *
 * One key for the whole family rather than one per digest: a sweep walks the
 * templates of *other* digests, so it has to exclude an invocation that is
 * half-way through building one. It is also, deliberately, the exact string the
 * pre-#289 code derived its key from, so an invocation running that code still
 * serializes against this one while the two versions coexist on a machine.
 */
export function templateFamilyName(base: string): string {
  assertSafeIdentifier(base);
  return `${base}${TEMPLATE_SUFFIX}`;
}

/** The digest a template name carries, or `undefined` for a name this module did not make. */
export function parseTemplateDatabaseName(
  base: string,
  name: string,
): { readonly digest: string } | undefined {
  if (!/^[A-Za-z0-9_]+$/.test(base)) return undefined;
  const match = new RegExp(
    `^${base}${TEMPLATE_SUFFIX}_([0-9a-f]{${TEMPLATE_DIGEST_LENGTH}})$`,
  ).exec(name);
  return match ? { digest: match[1] as string } : undefined;
}

/** What a template is built from: this run's migration order and the sources behind it. */
export interface TemplateInputs {
  /** The migration class names this run applies, in the order it applies them. */
  readonly migrations: readonly string[];
  /** Every file whose content decides what the migrated template holds. */
  readonly sources: readonly TemplateSource[];
}

export interface TemplateSource {
  /** Repository-relative, so two worktrees of the same commit agree. */
  readonly path: string;
  readonly sha256: string;
}

/**
 * What makes two runs' templates the same template.
 *
 * Issue #189 keyed the template on the base database alone and compared the
 * *names* of the applied migrations against this run's order before cloning it.
 * That catches a template another branch added a migration to. It does not
 * catch — and cannot — a branch that changed what a migration of the same name
 * *does*, which is the ordinary shape of two agents iterating on the same
 * feature, and it is how a run whose tree contained no such string failed
 * against a payment method row called `paypal_checkout` seeded from a branch it
 * had never seen (issue #289).
 *
 * So the identity is the whole input: the ordered class names — order included,
 * because a manifest `dependencies` edit reorders migrations without touching
 * one of them — and the content of every file that writes into the template,
 * which is every migration source plus the handful of files that seed the
 * platform invariants. Two trees that agree on all of it share a template and
 * pay one migration pass between them; two that do not cannot collide, because
 * they are not looking at the same database at all.
 *
 * It **throws on an empty input** rather than digesting nothing: every empty
 * input hashes to the same value, so a caller that read no migrations would
 * quietly name the same template as a caller that read all of them — a template
 * of unknown provenance, which is the defect and not a fix for it.
 */
export function templateDigest(inputs: TemplateInputs): string {
  if (inputs.migrations.length === 0) {
    throw new Error(
      'refusing to identify a migration template from no migrations — the digest would be the ' +
        'one every empty read produces, and every such run would share one template.',
    );
  }
  if (inputs.sources.length === 0) {
    throw new Error(
      'refusing to identify a migration template from no source files — the migration names ' +
        'alone cannot see a branch that changed what a migration of the same name does.',
    );
  }
  const hash = createHash('sha256');
  hash.update('migrations\n');
  for (const name of inputs.migrations) hash.update(`${name}\n`);
  hash.update('sources\n');
  for (const source of [...inputs.sources].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    hash.update(`${source.path} ${source.sha256}\n`);
  }
  return hash.digest('hex').slice(0, TEMPLATE_DIGEST_LENGTH);
}

/** What a template says about itself, in the comment PostgreSQL keeps on the database. */
export interface TemplateProvenance {
  readonly digest: string;
  /** How many migrations were applied when it was built — a second, cheaper thing to disagree about. */
  readonly migrations: number;
  readonly lastUsedAt: Date;
}

/** The marker that says the comment is ours and is the shape this version reads. */
const PROVENANCE_MARKER = 'b2b-test-template v1';

export function formatTemplateProvenance(provenance: TemplateProvenance): string {
  return (
    `${PROVENANCE_MARKER} digest=${provenance.digest} migrations=${provenance.migrations} ` +
    `lastUsedAt=${provenance.lastUsedAt.toISOString()}`
  );
}

/**
 * What the template says it is, or `undefined` when it says nothing this
 * version understands.
 *
 * Every "undefined" is a template a run must rebuild rather than clone: an
 * older version's template, a hand-made database that happens to fit the name,
 * one whose build died before it could sign itself. "I cannot tell what this
 * holds" and "this holds the wrong thing" get the same answer on purpose.
 */
export function parseTemplateProvenance(
  comment: string | null | undefined,
): TemplateProvenance | undefined {
  if (!comment || !comment.startsWith(PROVENANCE_MARKER)) return undefined;
  const digest = /\bdigest=([0-9a-f]+)/.exec(comment)?.[1];
  const migrations = /\bmigrations=(\d+)/.exec(comment)?.[1];
  const lastUsedAt = /\blastUsedAt=(\S+)/.exec(comment)?.[1];
  if (digest === undefined || migrations === undefined || lastUsedAt === undefined) {
    return undefined;
  }
  const at = new Date(lastUsedAt);
  if (Number.isNaN(at.getTime())) return undefined;
  return { digest, migrations: Number.parseInt(migrations, 10), lastUsedAt: at };
}

export interface StaleTemplateSelection {
  readonly base: string;
  /** Every database name on the cluster. */
  readonly names: readonly string[];
  readonly busy: ReadonlySet<string>;
  /** This invocation's own template, which is never stale. */
  readonly keep: string;
  /** When each template was last used, from its own provenance comment. */
  readonly lastUsed: ReadonlyMap<string, Date>;
  readonly now: Date;
  readonly maxAgeMs: number;
  readonly limit: number;
}

/**
 * The templates a sweep may drop.
 *
 * Keying templates by their migration set is what stops two branches sharing
 * one; the cost of it is that a branch leaves its set's template behind when it
 * merges, so something has to collect them. Same three conditions as the run
 * database sweep — a name this module generated, nothing connected, nobody
 * using it lately — with the age read from the template's own provenance
 * comment rather than from its name, because a template's useful age is when it
 * was last *used* and not when it was built.
 *
 * A template with no readable provenance is stale immediately. It is a database
 * no run would clone anyway (provisioning rebuilds one it cannot identify), so
 * leaving it costs disk and buys nothing. The pre-#289 `<base>_tpl` is not in
 * the population at all — `parseTemplateDatabaseName` refuses it — because an
 * invocation running older code clones that one *during* its run, and dropping
 * it under such a run would fail it for a reason in nobody's diff.
 */
export function staleTemplates(input: StaleTemplateSelection): string[] {
  const selected: string[] = [];
  for (const name of input.names) {
    if (selected.length >= input.limit) break;
    if (name === input.keep) continue;
    if (input.busy.has(name)) continue;
    if (!parseTemplateDatabaseName(input.base, name)) continue;
    const lastUsed = input.lastUsed.get(name);
    if (lastUsed && input.now.getTime() - lastUsed.getTime() < input.maxAgeMs) continue;
    selected.push(name);
  }
  return selected;
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

/**
 * Why the migration template cannot be brought forward to this run's migration
 * set by `migrator.up()`, and must be rebuilt from empty instead.
 */
export interface TemplateDrift {
  /**
   * `unknown-migration` — a name applied to the template that this run's
   * registry does not contain at all. `out-of-order` — one of this run's own
   * migrations, applied in a position the configured order does not put it in.
   */
  readonly kind: 'unknown-migration' | 'out-of-order';
  /** The applied migration the judgement is about. */
  readonly name: string;
  /** The migration this run's order has in that position, when there is one. */
  readonly expected?: string;
  /** The whole finding as one line, for the log or for a throw. */
  readonly message: string;
}

/**
 * Whether the template is a database this run's migrations could have produced.
 *
 * The template is **long-lived and shared by every branch on the machine**, and
 * it is only ever moved forward by `migrator.up()`, which appends. That is
 * enough exactly when what is already applied is a **prefix** of the order this
 * run configures: then the pending ones land after it, and the result is the
 * order a database migrated from scratch today would have. Anything else —
 * another branch's migration, or one of ours applied somewhere the order does
 * not put it — is a database no `up()` can repair, so it is rebuilt.
 *
 * Both shapes are ordinary here, not exotic. Five agents share one cluster, so
 * a template routinely carries a migration the branch running has never heard
 * of; and `orderMigrations` places a migration by its module's position in the
 * dependency graph, so a migration added anywhere but the last module lands at
 * the **end** of an incrementally-migrated template and in the **middle** of a
 * fresh one.
 *
 * That is not cosmetic. It broke
 * `test/integration/catalog/attributes-migration-parity.test.ts`, which drives
 * the real migrator: umzug reverts the last migration in *configured* order,
 * while the test reads the last one in *applied* (`id`) order, and the two stop
 * agreeing the moment the template stops being a prefix. The test then walked
 * `down()` past its own target, never reached its termination condition, timed
 * out, and left the run database with most of its schema reverted.
 */
export function templateDrift(
  applied: readonly string[],
  expected: readonly string[],
  templateName = 'the migration template',
): TemplateDrift | undefined {
  const known = new Set(expected);
  for (const [index, name] of applied.entries()) {
    if (name === expected[index]) continue;
    if (!known.has(name)) {
      return {
        kind: 'unknown-migration',
        name,
        message:
          `${templateName} has "${name}" applied, which this run's migration registry does ` +
          `not contain — another branch migrated it. Rebuilding it from empty.`,
      };
    }
    const inPosition = expected[index];
    return {
      kind: 'out-of-order',
      name,
      ...(inPosition === undefined ? {} : { expected: inPosition }),
      message:
        `${templateName} has "${name}" applied at position ${index + 1}, where this run's ` +
        `order has ${inPosition === undefined ? 'nothing' : `"${inPosition}"`} — an append ` +
        `cannot move it. Rebuilding it from empty.`,
    };
  }
  return undefined;
}
