import type { EntityManager, EntityName } from '@mikro-orm/core';
import type { Migration } from '@mikro-orm/migrations';
import { sqlWriteTargets, type SqlWriteTarget } from './sql-statement-targets.js';
import {
  RAW_BUILDER_HANDLES,
  driverMetadataMembers,
  migrationBuilders,
  sealConnection,
  sealDriver,
  sealedHandle,
  transactionSealer,
  unsealed,
  type SealHooks,
} from './raw-handles.js';
import type { ReverseEdgeClause } from './reverse-edge.js';
import { allMetadata } from './all-metadata.js';
import { resolvedColumnExtension } from '../kernel/schema-extensions/define.js';
import type { ColumnExtension } from '../kernel/schema-extensions/types.js';

/** host → the exact physical column names `declarations` declare there. */
export function declaredColumnsByHost(declarations: readonly ColumnExtension[]): Map<string, ReadonlySet<string>> {
  const out = new Map<string, Set<string>>();
  for (const declaration of declarations) {
    const resolved = resolvedColumnExtension(declaration);
    const set = out.get(resolved.host) ?? new Set<string>();
    for (const column of resolved.columns) set.add(column.physicalName);
    out.set(resolved.host, set);
  }
  return out;
}

/**
 * The runtime refusal of foreign schema writes by installed packages
 * (`specs/178-extensible-columns/` FR-070, OR-5 / OD-17 b,
 * `contracts/foreign-schema-guard.md` §1).
 *
 * In the release that lets a package declare columns on a core table, the raw
 * route is closed: every migration of origin `external` runs through this guard,
 * which classifies each statement it hands to `addSql` / `execute` and refuses
 * DDL or DML on a table the module does not own. Refused, not warned — the
 * migration run rolls back and `migrate` fails naming the package, the
 * migration, the table and the statement.
 *
 * A table is the module's own when one of its entities maps it, or one of its
 * migrations creates it. Also allowed: the platform's own tables (the R2 rule's
 * kernel exclusion), `update <host> set <own x_ columns>` on a host the module
 * declares extension columns on — its back-fill — and the first-party R2
 * exemptions `composer:generate` renders from
 * `backend/scripts/ledgers/migration-foreign-writes/` (FR-071), which is what
 * lets an instance install this repository's modules as packages.
 *
 * The guard is a **subclass** of the package's class with the same `name`, so
 * the migration table records what it always did (research R-10, spiked).
 * `getEntityManager()` is guarded at flush time (OD-178-3, ruled D-291): its
 * change sets, and its `native*` / `insert*` / `upsert*` / `execute` shortcuts,
 * are held to the same verdict, so the ORM is not a way around the statement
 * check.
 *
 * **Own tables a migration created in an earlier run are found by a dry run** —
 * each of the module's migrations' `up()` is called once with `execute`
 * answering no rows, and the `create table`s it queues are collected — lazily,
 * the first time one of the module's migrations runs in the process, never at
 * boot.
 */

/** The class shape MikroORM instantiates. */
export type MigrationClass = new (...args: never[]) => Migration;

export interface ForeignWriteExemption {
  readonly moduleId: string;
  readonly migration: string;
  readonly table: string;
  /**
   * `write` (the default) — an R2 ledger write. `bridge` — a first-party D-226
   * bridge whose migration may destroy the table another module's entity maps,
   * in `direction` only (D-291 R-A6). Both are rendered by `composer:generate`.
   */
  readonly kind?: 'write' | 'bridge' | 'derived-down';
  readonly direction?: 'up' | 'down';
  /** For `derived-down`: the R-A7 clause that exempts it, recorded for the reader. */
  readonly clause?: ReverseEdgeClause;
}

/**
 * D-291 R-A7 at run time — who owns a table, and whether the owner can outlive
 * this module's revert. Applies to every author; an owner that cannot be
 * attributed is no exemption (fail closed).
 */
export interface ReverseEdges {
  /** Each installed module's entity classes — the owner of a table they map. */
  readonly entitiesByModule?: ReadonlyMap<string, readonly unknown[]>;
  /** Or the owner directly (tests). */
  readonly ownerOf?: (table: string) => string | undefined;
  /** The clause letting this module destroy what `owner` owns in a `down()`, or `null`. */
  readonly clause: (owner: string) => ReverseEdgeClause | null;
}

export interface ForeignSchemaGuardContext {
  readonly moduleId: string;
  readonly packageName: string;
  /** The package's entity classes — their tables are its own. */
  readonly entities: readonly unknown[];
  /** The platform's entity classes — their tables are allowed (R2's kernel exclusion). */
  readonly platformEntities: readonly unknown[];
  /**
   * Hosts the module declares extension columns on → the exact physical names
   * it declares there. Exact, not a prefix: `x_<module>_` is ambiguous across
   * modules (`acme` + `erpCode` vs `acme_erp` + `code`), review finding 4.
   */
  readonly declaredHosts: ReadonlyMap<string, ReadonlySet<string>>;
  readonly exemptions: readonly ForeignWriteExemption[];
  /** Every migration class of the module, raw — the dry run's population. */
  readonly moduleMigrations: () => readonly MigrationClass[];
  /** D-291 R-A7 — the derived `down()` exemption. Absent: none applies. */
  readonly reverseEdges?: ReverseEdges;
}

/** `foreign-schema-write` — a package migration wrote a table its module does not own. */
export class ForeignSchemaWriteError extends Error {
  readonly code = 'foreign-schema-write';

  constructor(
    readonly packageName: string,
    readonly moduleId: string,
    readonly migration: string,
    readonly table: string,
    readonly statement: string,
    readonly direction?: 'up' | 'down',
  ) {
    super(
      `[foreign-schema-write] ${packageName} (module "${moduleId}"), migration ${migration}, writes ` +
        `table "${table}", which "${moduleId}" does not own: ${statement}\n` +
        `A package migration may write only its own tables — the ones its entities map or its ` +
        `migrations create — and, on a host it declares extension columns on, an \`update … set\` of ` +
        `its own x_${moduleId}_* columns. Declare columns with defineColumnExtension instead of ` +
        `altering a core table, and change another module's rows through that module's port. ` +
        `The migration run was rolled back.`,
    );
    this.name = 'ForeignSchemaWriteError';
  }
}

const MIGRATIONS_TABLE = 'mikro_orm_migrations';

interface MetadataLike {
  readonly class?: unknown;
  readonly className: string;
  readonly tableName?: string;
  readonly collection?: string;
  readonly properties: Record<string, { readonly fieldNames?: readonly string[] } | undefined>;
}

interface DriverLike {
  getMetadata(): { getAll(): Map<unknown, MetadataLike> | Record<string, MetadataLike> };
}

/** The driver a guarded migration holds behind its sealed `driver` field. */
type RealDriver = DriverLike & { execute(...args: unknown[]): Promise<unknown> };

/** Tables the classes in `classes` map, by the ORM's discovered metadata. */
function tablesOf(driver: DriverLike, classes: readonly unknown[]): Set<string> {
  const wanted = new Set(classes);
  const names = new Set(
    classes.map((cls) => (typeof cls === 'function' ? (cls as { name: string }).name : undefined)),
  );
  const tables = new Set<string>();
  for (const meta of allMetadata(driver.getMetadata())) {
    if (!wanted.has(meta.class) && !names.has(meta.className)) continue;
    const table = meta.tableName ?? meta.collection;
    if (table !== undefined) tables.add(table.toLowerCase());
  }
  return tables;
}

/** table → owning module, from `edges`, by the ORM's metadata. */
function ownerLookup(driver: DriverLike, edges: ReverseEdges | undefined): (table: string) => string | undefined {
  if (edges === undefined) return () => undefined;
  if (edges.ownerOf !== undefined) return edges.ownerOf;
  const owners = new Map<string, string>();
  for (const [moduleId, entities] of edges.entitiesByModule ?? []) {
    for (const table of tablesOf(driver, entities)) owners.set(table, moduleId);
  }
  return (table) => owners.get(table);
}

/** Every table some discovered entity maps — the tables a `create table` cannot make one's own. */
function mappedTables(driver: DriverLike): Set<string> {
  const tables = new Set<string>();
  for (const meta of allMetadata(driver.getMetadata())) {
    const table = meta.tableName ?? meta.collection;
    if (table !== undefined) tables.add(table.toLowerCase());
  }
  return tables;
}

/**
 * Whether a table the module's migration creates becomes its own: yes, unless
 * an entity the module does not ship maps it. A migration of one module that
 * once created another module's table — the history of a split — does not make
 * that table its own, which is R2's owner map (entity first) at run time.
 */
function adopts(table: string, mine: ReadonlySet<string>, mapped: ReadonlySet<string>): boolean {
  return mine.has(table) || !mapped.has(table);
}

/**
 * A query as `addSql` / `execute` accept it, rendered to the text the ORM sends.
 *
 * MikroORM 7 (#1866) accepts three shapes: a string, a `raw()` fragment
 * (`{ sql, params }`) and a native query builder (`compile()` → `{ sql, params }`).
 * A fragment and a builder carry their own parameters, which the ORM
 * substitutes client-side, so they are rendered through `platform` exactly as
 * {@link renderedForVerdict} renders a string's. A shape this does not know is
 * refused rather than judged on `Object.prototype.toString`'s
 * `[object …]` text, which names no table and would pass (fail closed).
 */
export function queryText(query: unknown, platform?: FormattingPlatform): string {
  if (typeof query === 'string') return query;
  if (query !== null && typeof query === 'object') {
    const candidate = query as {
      sql?: unknown;
      params?: unknown;
      compile?: () => { sql: string; params: unknown[] };
      toString?: () => string;
    };
    if (typeof candidate.compile === 'function') {
      const { sql, params } = candidate.compile();
      return renderedForVerdict(sql, params, platform);
    }
    if (typeof candidate.sql === 'string' && Array.isArray(candidate.params)) {
      return renderedForVerdict(candidate.sql, candidate.params, platform);
    }
    if (typeof candidate.toString === 'function' && candidate.toString !== Object.prototype.toString) {
      return candidate.toString();
    }
  }
  throw new Error('[foreign-schema-guard] a statement of a shape the guard cannot render is refused');
}

/** `query` with `params`, as `execute(query, params)` sends it: only a string takes `params`. */
function statementText(query: unknown, params: readonly unknown[] | undefined, platform: FormattingPlatform | undefined): string {
  return typeof query === 'string' ? renderedForVerdict(query, params, platform) : queryText(query, platform);
}

/** The part of the ORM's platform the verdict uses: its own parameter substitution. */
interface FormattingPlatform {
  formatQuery(sql: string, params: readonly unknown[]): string;
}

/**
 * `sql` as the ORM renders it before sending it (issue #1864): MikroORM
 * substitutes `execute(sql, params)` client-side through
 * `Platform.formatQuery` — `??` becomes an identifier, `?` an escaped value,
 * and a `raw()` fragment its SQL — so the verdict reads that text, not the
 * template. Without a platform to render with, a statement that carries
 * parameters is refused rather than judged on its template (fail closed).
 */
export function renderedForVerdict(
  sql: string,
  params: readonly unknown[] | undefined,
  platform: FormattingPlatform | undefined,
): string {
  if (params === undefined || params.length === 0) return sql;
  if (typeof platform?.formatQuery !== 'function') {
    throw new Error('[foreign-schema-guard] a parameterised statement cannot be rendered without the platform');
  }
  return platform.formatQuery(sql, [...params]);
}

const platformOf = (holder: unknown): FormattingPlatform | undefined =>
  (holder as { getPlatform?: () => FormattingPlatform } | undefined)?.getPlatform?.();

/**
 * The statements `cls.up()` queues, without running any of them — for the
 * guard's own-table dry run and for `module:schema-extensions audit-packages`
 * (FR-073). `execute` answers no rows and records its text; the entity manager
 * is not offered. A migration whose `up()` throws in a dry run contributes what
 * it queued before throwing.
 */
export async function dryRunStatements(
  cls: MigrationClass,
  driver: unknown,
  config: unknown,
  method: 'up' | 'down' = 'up',
): Promise<{ readonly statements: readonly string[]; readonly error: unknown }> {
  const Ctor = cls as unknown as new (driver: unknown, config: unknown) => Migration;
  // Review finding 6 — no route to the database: the driver the instance holds
  // answers metadata and platform questions and refuses everything else (#1889:
  // sealed, so a member nobody listed is refused too), and the raw query
  // builders are refused (fail closed).
  const refuse = (what: string) => new Error(`[foreign-schema-guard] ${what} is not available in a dry run`);
  const denied = (what: string) => (): never => {
    throw refuse(what);
  };
  const guardedDriver = sealedHandle(
    'this.driver',
    {
      ...driverMetadataMembers(driver),
      execute: denied('driver.execute()'),
      getConnection: denied('driver.getConnection()'),
      createEntityManager: denied('driver.createEntityManager()'),
    },
    refuse,
  );
  const instance = new Ctor(guardedDriver, config);
  const executed: string[] = [];
  Object.assign(instance, {
    execute: async (sql: unknown, params?: unknown[]) => {
      executed.push(statementText(sql, params, platformOf(driver)));
      return [];
    },
    getEntityManager: denied('the entity manager'),
    ...migrationBuilders((handle) => refuse(`a statement run through this.${handle}()`)),
  });
  let error: unknown = null;
  try {
    await instance[method]();
  } catch (caught) {
    error = caught;
  }
  return {
    statements: [...executed, ...instance.getQueries().map((query) => queryText(query, platformOf(driver)))],
    error,
  };
}

/** The per-module, per-process state the guard accumulates. */
interface ModuleState {
  own: Set<string> | null;
  mine: Set<string>;
  mapped: Set<string>;
}

const STATES = new WeakMap<ForeignSchemaGuardContext, ModuleState>();

function stateOf(context: ForeignSchemaGuardContext): ModuleState {
  let state = STATES.get(context);
  if (state === undefined) {
    state = { own: null, mine: new Set(), mapped: new Set() };
    STATES.set(context, state);
  }
  return state;
}

/** The verbs that change a table's schema rather than its rows. */
const DDL_VERBS = new Set(['alter', 'index', 'drop', 'drop-index', 'comment', 'trigger', 'rule', 'policy']);

/** The table a refusal names when the statement's target cannot be read. */
const DYNAMIC_SQL = '(dynamic SQL)';

/**
 * The verdict on one write target; `null` is allowed.
 *
 * `createdHere` is what the same migration creates: DDL on such a table is part
 * of declaring it — indexing it beside its `create table`, dropping it in
 * `down()` — whoever maps it today, which is R2's own rule
 * (`lib/sql-tables.ts`, "a table the same source creates is not an existing
 * table") and what lets a migration from before a module split run in an
 * instance. Its rows are still the owner's.
 */
function verdictOn(
  context: ForeignSchemaGuardContext,
  migration: string,
  own: ReadonlySet<string>,
  platform: ReadonlySet<string>,
  target: { readonly table: string; readonly verb: string; readonly setColumns?: readonly string[] | null },
  createdHere: ReadonlySet<string> = new Set(),
): string | null {
  const table = target.table;
  if (own.has(table) || platform.has(table) || table === MIGRATIONS_TABLE) return null;
  if (DDL_VERBS.has(target.verb) && createdHere.has(table)) return null;
  const declared = context.declaredHosts.get(table);
  if (
    declared !== undefined &&
    target.verb === 'update' &&
    target.setColumns !== null &&
    target.setColumns !== undefined &&
    target.setColumns.length > 0 &&
    target.setColumns.every((column) => declared.has(column))
  ) {
    return null;
  }
  if (
    context.exemptions.some(
      (exemption) =>
        (exemption.kind ?? 'write') === 'write' &&
        exemption.moduleId === context.moduleId &&
        exemption.migration === migration &&
        exemption.table === table,
    )
  ) {
    return null;
  }
  return table;
}

/** Statements that destroy a table or part of it. */
function destroys(target: { readonly verb: string; readonly destructive?: boolean }): boolean {
  return (
    target.verb === 'drop' ||
    target.verb === 'truncate' ||
    target.verb === 'drop-index' ||
    (target.verb === 'alter' && target.destructive === true)
  );
}

/**
 * D-291 R-A6 — a package may not destroy a table another module's entity maps,
 * in `up()` or `down()`, whatever the same migration created; only a derived
 * first-party bridge exemption, in its own direction, lets one through.
 * `null` is allowed.
 */
function destructionRefused(
  context: ForeignSchemaGuardContext,
  migration: string,
  mine: ReadonlySet<string>,
  mapped: ReadonlySet<string>,
  target: { readonly table: string; readonly verb: string; readonly destructive?: boolean },
  direction: 'up' | 'down',
  ownerOf: (table: string) => string | undefined = () => undefined,
): string | null | typeof EXEMPT {
  if (!destroys(target) || !mapped.has(target.table) || mine.has(target.table)) return null;
  if (direction === 'down') {
    // D-291 R-A7 — the owner cannot be present when this revert runs.
    const derived = context.exemptions.some(
      (exemption) =>
        exemption.kind === 'derived-down' &&
        exemption.moduleId === context.moduleId &&
        exemption.migration === migration &&
        exemption.table === target.table,
    );
    if (derived) return EXEMPT;
    const owner = ownerOf(target.table);
    if (owner !== undefined && owner !== context.moduleId && context.reverseEdges?.clause(owner) != null) return EXEMPT;
  }
  const bridged = context.exemptions.some(
    (exemption) =>
      exemption.kind === 'bridge' &&
      exemption.direction === direction &&
      exemption.moduleId === context.moduleId &&
      exemption.migration === migration &&
      exemption.table === target.table,
  );
  return bridged ? EXEMPT : target.table;
}

/** A destruction the bridge or R-A7 rule allows outright — no further verdict applies. */
const EXEMPT = Symbol('exempt');

/**
 * `cls` with every statement it issues judged before it runs. Same `name`, so
 * the migration table and the ordering see the package's own class.
 */
export function guardExternalMigration<T extends MigrationClass>(cls: T, context: ForeignSchemaGuardContext): T {
  const migrationName = cls.name;
  const Base = cls as unknown as new (...args: unknown[]) => Migration;

  const refuse = (what: string) =>
    new ForeignSchemaWriteError(context.packageName, context.moduleId, migrationName, what, `${what} is not offered`);

  class GuardedMigration extends Base {
    #platform: Set<string> | null = null;
    #createdIndexes = new Map<string, string>();
    #createdHere = new Set<string>();
    #reverting = false;
    #ownerOf: ((table: string) => string | undefined) | undefined;
    /** The real driver; the migration's own `driver` field holds it sealed (#1889). */
    readonly #driver: RealDriver;
    /** The real transaction context; the migration's own `ctx` hands it out sealed. */
    #ctx: unknown;

    constructor(...args: unknown[]) {
      super(...args);
      const self = this as unknown as { driver: unknown; ctx: unknown };
      this.#driver = self.driver as RealDriver;
      const hooks = this.#sealHooks();
      // Issue #1889 — every raw handle the Migration API offers: `this.driver`
      // (what `execute()` and `getEntityManager()` reach through, too), the
      // transaction context `this.ctx`, and the query builders.
      self.driver = sealDriver(this.#driver, 'this.driver', hooks);
      const sealTransaction = transactionSealer('this.ctx', refuse);
      this.#ctx = self.ctx;
      Object.defineProperty(this, 'ctx', {
        configurable: true,
        enumerable: true,
        get: () => sealTransaction(this.#ctx),
        set: (ctx: unknown) => {
          this.#ctx = unsealed(ctx);
        },
      });
      Object.assign(this, migrationBuilders((handle) => refuse(`a statement run through this.${handle}()`)));
    }

    #sealHooks(): SealHooks {
      const judges: EntityManagerJudges = {
        judge: (target) => this.#judgeTarget(target),
        judgeSql: (sql) => this.#judge(sql),
        refuse,
      };
      return {
        judgeStatement: (query, params) => this.#judge(statementText(query, params, platformOf(this.#driver))),
        judgeTable: (table, verb, statement) => this.#judgeTarget({ table, verb, setColumns: null, statement }),
        refuse,
        guardEntityManager: (em) => {
          guardEntityManager(em as unknown as EntityManager, judges);
          return em;
        },
      };
    }

    async #own(): Promise<Set<string>> {
      const state = stateOf(context);
      if (state.own === null) {
        const driver = this.#driver;
        const config = (this as unknown as { config: unknown }).config;
        const mine = tablesOf(driver, context.entities);
        const mapped = mappedTables(driver);
        const own = new Set(mine);
        for (const migrationClass of context.moduleMigrations()) {
          const { statements } = await dryRunStatements(migrationClass, driver, config);
          for (const statement of statements) {
            for (const target of sqlWriteTargets(statement)) {
              if (target.verb === 'create' && target.table !== null && adopts(target.table, mine, mapped)) {
                own.add(target.table);
              }
            }
          }
        }
        state.own = own;
        state.mine = mine;
        state.mapped = mapped;
      }
      return state.own;
    }

    #platformTables(): Set<string> {
      this.#platform ??= tablesOf(this.#driver, context.platformEntities);
      return this.#platform;
    }

    async #indexTable(index: string): Promise<string | null> {
      const created = this.#createdIndexes.get(index);
      if (created !== undefined) return created;
      const rows = (await this.#driver.execute(
        `select tablename from pg_indexes where schemaname = current_schema() and indexname = ?`,
        [index],
        'all',
        this.#ctx,
      )) as Array<{ tablename?: string }>;
      return rows[0]?.tablename?.toLowerCase() ?? null;
    }

    /** Judge one statement text; throws on the first foreign target. */
    async #judge(sql: string): Promise<void> {
      const own = await this.#own();
      for (const target of sqlWriteTargets(sql) as SqlWriteTarget[]) {
        if (target.verb === 'create') {
          const state = stateOf(context);
          if (target.table !== null) {
            if (adopts(target.table, state.mine, state.mapped)) {
              own.add(target.table);
              this.#createdHere.add(target.table);
            } else if (target.ifNotExists !== true || this.#reverting) {
              // A plain create of a table another module's entity maps either
              // creates it (a pre-split init) or fails in PostgreSQL itself.
              this.#createdHere.add(target.table);
            }
            // `create table if not exists` on a table another module's entity
            // maps may be a no-op on a table that is already there, so in `up()`
            // it declares nothing and licenses no DDL on it (review finding 3).
            // The create itself is let through: this repository's own
            // `inventory` bridge migration has exactly that shape (D-226).
            continue;
          }
          continue;
        }
        if (target.verb === 'index' && target.table !== null) {
          const named = /\bindex\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_$]*)"?\s+on\b/i.exec(
            target.statement,
          );
          if (named !== null) this.#createdIndexes.set(named[1]!.toLowerCase(), target.table);
        }
        if (target.verb === 'dynamic') {
          throw new ForeignSchemaWriteError(context.packageName, context.moduleId, migrationName, DYNAMIC_SQL, target.statement);
        }
        const table = target.table ?? (target.index === undefined ? null : await this.#indexTable(target.index));
        if (table === null) continue;
        const state = stateOf(context);
        const direction = this.#reverting ? 'down' : 'up';
        this.#ownerOf ??= ownerLookup(this.#driver, context.reverseEdges);
        const destroyed = destructionRefused(
          context,
          migrationName,
          state.mine,
          state.mapped,
          { ...target, table },
          direction,
          this.#ownerOf,
        );
        if (destroyed === EXEMPT) continue;
        if (destroyed !== null) {
          throw new ForeignSchemaWriteError(
            context.packageName,
            context.moduleId,
            migrationName,
            destroyed,
            target.statement,
            direction,
          );
        }
        const refused = verdictOn(
          context,
          migrationName,
          own,
          this.#platformTables(),
          { ...target, table },
          this.#createdHere,
        );
        if (refused !== null) {
          throw new ForeignSchemaWriteError(
            context.packageName,
            context.moduleId,
            migrationName,
            refused,
            target.statement,
          );
        }
      }
    }

    async #judgeQueued(): Promise<void> {
      const queued = this.getQueries().map((query) => queryText(query, platformOf(this.#driver)));
      // The whole migration's `create table`s first: R2 reads "the same source
      // creates" over the file, not up to the statement.
      await this.#own();
      const state = stateOf(context);
      for (const sql of queued) {
        for (const target of sqlWriteTargets(sql)) {
          if (target.verb !== 'create' || target.table === null) continue;
          if (!this.#reverting && target.ifNotExists === true && !adopts(target.table, state.mine, state.mapped)) {
            continue;
          }
          this.#createdHere.add(target.table);
        }
      }
      for (const sql of queued) await this.#judge(sql);
    }

    override async up(): Promise<void> {
      // `up` is abstract on `Migration`, so `super.up()` does not type; the
      // package's class is concrete and its prototype carries it.
      await (Base.prototype as Migration).up.call(this);
      await this.#judgeQueued();
    }

    override async down(): Promise<void> {
      this.#reverting = true;
      await super.down();
      // "The same source" is the migration, both halves: the tables its `up()`
      // creates are the ones its `down()` may drop (R2's reading).
      const config = (this as unknown as { config: unknown }).config;
      for (const statement of (await dryRunStatements(cls, this.#driver, config, 'up')).statements) {
        for (const target of sqlWriteTargets(statement)) {
          if (target.verb === 'create' && target.table !== null) this.#createdHere.add(target.table);
        }
      }
      this.#reverting = true;
      await this.#judgeQueued();
    }

    // `execute()` and `getEntityManager()` are the base class's: they reach the
    // database through `this.driver`, which is sealed — its `execute` judges the
    // statement as the ORM renders it, and the entity manager it creates is
    // guarded (OD-178-3).

    async #judgeTarget(target: {
      readonly table: string;
      readonly verb: string;
      readonly setColumns: readonly string[] | null;
      readonly statement: string;
    }): Promise<void> {
      const refused = verdictOn(context, migrationName, await this.#own(), this.#platformTables(), target);
      if (refused !== null) {
        throw new ForeignSchemaWriteError(
          context.packageName,
          context.moduleId,
          migrationName,
          refused,
          target.statement,
        );
      }
    }
  }

  Object.defineProperty(GuardedMigration, 'name', { value: migrationName });
  return GuardedMigration as unknown as T;
}

const GUARDED = Symbol.for('endora.foreign-schema-guard');

type TargetJudge = (target: {
  readonly table: string;
  readonly verb: string;
  readonly setColumns: readonly string[] | null;
  readonly statement: string;
}) => Promise<void>;

/** How a guarded entity manager judges what it writes, and refuses what it cannot judge. */
interface EntityManagerJudges {
  readonly judge: TargetJudge;
  readonly judgeSql: (sql: string) => Promise<void>;
  readonly refuse: (what: string) => Error;
}

/**
 * Hold a migration's entity manager to the statement verdict (OD-178-3): its
 * flush, by change set, and the shortcuts that bypass the unit of work.
 */
function guardEntityManager(em: EntityManager, judges: EntityManagerJudges): void {
  const marked = em as unknown as { [GUARDED]?: true };
  if (marked[GUARDED] === true) return;
  marked[GUARDED] = true;
  const { judge, judgeSql, refuse } = judges;
  const metaOf = (entityName: EntityName<object> | object): MetadataLike => {
    // `em.insert(entity)` names no entity: the instance carries its class.
    const name =
      typeof entityName === 'string' || typeof entityName === 'function'
        ? entityName
        : (entityName as { constructor: unknown }).constructor;
    return em.getMetadata().find(name as never) as unknown as MetadataLike;
  };
  const tableOf = (meta: MetadataLike): string => (meta.tableName ?? meta.collection ?? meta.className).toLowerCase();
  const columnsOf = (meta: MetadataLike, props: readonly string[]): string[] =>
    props.flatMap((prop) => meta.properties[prop]?.fieldNames ?? [prop]).map((column) => column.toLowerCase());

  const flush = em.flush.bind(em);
  Object.assign(em, {
    flush: async () => {
      const uow = em.getUnitOfWork();
      uow.computeChangeSets();
      for (const changeSet of uow.getChangeSets()) {
        const meta = changeSet.meta as unknown as MetadataLike;
        const verb = changeSet.type === 'update' ? 'update' : changeSet.type === 'create' ? 'insert' : 'delete';
        await judge({
          table: tableOf(meta),
          verb,
          setColumns: verb === 'update' ? columnsOf(meta, Object.keys(changeSet.payload ?? {})) : null,
          statement: `flush: ${changeSet.type} ${meta.className}`,
        });
      }
      return flush();
    },
  });

  const writes: Array<[keyof EntityManager, 'insert' | 'update' | 'delete']> = [
    ['nativeInsert' as keyof EntityManager, 'insert'],
    ['insert', 'insert'],
    ['insertMany', 'insert'],
    ['upsert', 'insert'],
    ['upsertMany', 'insert'],
    ['nativeUpdate', 'update'],
    ['nativeDelete', 'delete'],
  ];
  for (const [method, verb] of writes) {
    const original = (em as unknown as Record<string, unknown>)[method as string];
    if (typeof original !== 'function') continue;
    Object.assign(em, {
      [method]: async (entityName: EntityName<object>, ...rest: unknown[]) => {
        const meta = metaOf(entityName);
        const data = verb === 'update' ? (rest[1] as Record<string, unknown> | undefined) : undefined;
        await judge({
          table: tableOf(meta),
          verb,
          setColumns: data === undefined ? null : columnsOf(meta, Object.keys(data)),
          statement: `${String(method)} ${meta.className}`,
        });
        return (original as (...args: unknown[]) => unknown).call(em, entityName, ...rest);
      },
    });
  }

  const execute = (em as unknown as { execute?: (...args: unknown[]) => unknown }).execute;
  if (typeof execute === 'function') {
    Object.assign(em, {
      execute: async (sql: unknown, ...rest: unknown[]) => {
        await judgeSql(statementText(sql, rest[0] as unknown[] | undefined, platformOf(em)));
        return execute.call(em, sql, ...rest);
      },
    });
  }

  // Review finding 5 — every other way the entity manager reaches SQL.
  const raw = em as unknown as Record<string, (...args: unknown[]) => unknown>;
  const createQueryBuilder = raw['createQueryBuilder'];
  if (typeof createQueryBuilder === 'function') {
    const wrap = (qb: Record<string, unknown>): unknown => {
      const text = (): string => String((qb['getFormattedQuery'] as () => string).call(qb));
      const execute = qb['execute'] as ((...a: unknown[]) => Promise<unknown>) | undefined;
      if (typeof execute === 'function') {
        qb['execute'] = async (...args: unknown[]) => {
          await judgeSql(text());
          return execute.apply(qb, args);
        };
      }
      const then = qb['then'] as ((...a: unknown[]) => unknown) | undefined;
      if (typeof then === 'function') {
        qb['then'] = (onFulfilled?: unknown, onRejected?: (reason: unknown) => unknown) =>
          judgeSql(text()).then(() => then.call(qb, onFulfilled, onRejected), onRejected);
      }
      return qb;
    };
    for (const name of ['createQueryBuilder', 'qb']) {
      const original = raw[name];
      if (typeof original !== 'function') continue;
      Object.assign(em, { [name]: (...args: unknown[]) => wrap(original.apply(em, args) as Record<string, unknown>) });
    }
  }
  // Issue #1889 — the driver and the connection are sealed: what runs SQL is
  // judged, a transaction is handed out sealed, and the raw client is refused.
  const hooks: SealHooks = {
    judgeStatement: (query, params) => judgeSql(statementText(query, params, platformOf(em))),
    judgeTable: (table, verb, statement) => judge({ table, verb, setColumns: null, statement }),
    refuse,
    guardEntityManager: (other) => {
      guardEntityManager(other as unknown as EntityManager, judges);
      return other;
    },
  };
  const getConnection = raw['getConnection'];
  if (typeof getConnection === 'function') {
    Object.assign(em, {
      getConnection: (...args: unknown[]) =>
        sealConnection(getConnection.apply(em, args), 'getEntityManager().getConnection()', hooks),
    });
  }
  const getDriver = raw['getDriver'];
  if (typeof getDriver === 'function') {
    const sealed = sealDriver(getDriver.call(em), 'getEntityManager().getDriver()', hooks);
    Object.assign(em, { getDriver: () => sealed });
  }
  // A raw query builder runs SQL nothing here can judge: not offered (fail closed).
  for (const handle of RAW_BUILDER_HANDLES) {
    Object.assign(em, {
      [handle]: () => {
        throw refuse(`getEntityManager().${handle}()`);
      },
    });
  }
  // A sealed transaction is a transaction context again where it re-enters the
  // entity manager — the ORM's own `transactional()` sets the one a sealed
  // connection handed it, and `begin()` stores what the sealed connection began.
  const setTransactionContext = raw['setTransactionContext'];
  if (typeof setTransactionContext === 'function') {
    Object.assign(em, { setTransactionContext: (ctx: unknown) => setTransactionContext.call(em, unsealed(ctx)) });
  }
  // MikroORM 7 (#1866) keeps the context in a private `#transactionContext`, so
  // it is read and written back through the entity manager's own accessors —
  // the real `setTransactionContext`, not the unsealing override above, which
  // would do the same thing one call later.
  const begin = raw['begin'];
  const getTransactionContext = raw['getTransactionContext'];
  if (typeof begin === 'function') {
    Object.assign(em, {
      begin: async (...args: unknown[]) => {
        await begin.apply(em, args);
        if (typeof getTransactionContext !== 'function' || typeof setTransactionContext !== 'function') return;
        const current = getTransactionContext.call(em);
        const real = unsealed(current);
        if (real !== current) setTransactionContext.call(em, real);
      },
    });
  }
  // A fork, and the entity manager a `transactional` callback receives, are
  // guarded the same way.
  const fork = raw['fork'];
  if (typeof fork === 'function') {
    Object.assign(em, {
      fork: (...args: unknown[]) => {
        const forked = fork.apply(em, args) as EntityManager;
        guardEntityManager(forked, judges);
        return forked;
      },
    });
  }
  const transactional = raw['transactional'];
  if (typeof transactional === 'function') {
    Object.assign(em, {
      transactional: (callback: (inner: EntityManager) => unknown, ...rest: unknown[]) =>
        transactional.call(
          em,
          (inner: EntityManager) => {
            guardEntityManager(inner, judges);
            return callback(inner);
          },
          ...rest,
        ),
    });
  }
}

/** One would-be refusal of {@link auditForeignSchemaWrites}. */
export interface ForeignWriteFinding {
  readonly packageName: string;
  readonly moduleId: string;
  readonly migration: string;
  readonly method: 'up' | 'down';
  readonly table: string;
  readonly statement: string;
}

/** The part of a package's schema contribution the audit reads. */
export interface AuditedPackage {
  readonly id: string;
  readonly packageName: string;
  readonly entities: readonly unknown[];
  readonly migrations: readonly { readonly cls: unknown }[];
  readonly schemaExtensions?: readonly ColumnExtension[];
}

export interface ForeignWriteAudit {
  readonly findings: readonly ForeignWriteFinding[];
  readonly migrations: number;
  readonly statements: number;
  /** `drop index` statements whose index no audited migration creates — not judged. */
  readonly unresolvedIndexes: readonly string[];
  /** Migrations whose dry run threw — judged on what they queued before it. */
  readonly dryRunErrors: readonly { readonly migration: string; readonly message: string }[];
}

/**
 * The guard's verdict over installed packages' migrations **without executing
 * them** (`specs/178-extensible-columns/` FR-073) — what
 * `module:schema-extensions audit-packages` prints, so an operator can check the
 * packages on a release before upgrading to the one that refuses.
 *
 * Every migration's `up()` and `down()` is dry-run ({@link dryRunStatements}) and
 * each queued statement is held to the same rule the guard applies at
 * `migrate`. A `drop index` is resolved through the indexes the audited
 * migrations create, since there is no database to ask; one that none creates
 * is reported as unresolved rather than judged.
 */
export async function auditForeignSchemaWrites(input: {
  readonly packages: readonly AuditedPackage[];
  readonly driver: unknown;
  readonly config: unknown;
  readonly platformEntities: readonly unknown[];
  readonly exemptions: readonly ForeignWriteExemption[];
  /** Override the own-table derivation (entities ∪ creates) — a test models an instance with it. */
  readonly ownTables?: (moduleId: string) => ReadonlySet<string> | undefined;
  /** D-291 R-A7 at run time: the owner of a table, and the clause for (writer, owner). */
  readonly reverseEdges?: {
    readonly ownerOf: (table: string) => string | undefined;
    readonly clause: (writer: string, owner: string) => ReverseEdgeClause | null;
  };
}): Promise<ForeignWriteAudit> {
  const driver = input.driver as DriverLike;
  const platform = tablesOf(driver, input.platformEntities);
  const mapped = mappedTables(driver);
  const runs: Array<{
    readonly pkg: AuditedPackage;
    readonly migration: string;
    readonly method: 'up' | 'down';
    readonly targets: readonly SqlWriteTarget[];
  }> = [];
  const dryRunErrors: Array<{ migration: string; message: string }> = [];
  const indexTables = new Map<string, string>();
  const created = new Map<string, Set<string>>();
  let statements = 0;
  for (const pkg of input.packages) {
    const own = created.get(pkg.id) ?? new Set<string>();
    created.set(pkg.id, own);
    for (const entry of pkg.migrations) {
      const cls = entry.cls as MigrationClass;
      for (const method of ['up', 'down'] as const) {
        const run = await dryRunStatements(cls, input.driver, input.config, method);
        if (run.error !== null && method === 'up') {
          dryRunErrors.push({ migration: cls.name, message: String((run.error as Error)?.message ?? run.error) });
        }
        const targets = run.statements.flatMap((statement) => sqlWriteTargets(statement));
        statements += run.statements.length;
        for (const target of targets) {
          if (target.table === null) continue;
          if (target.verb === 'create') own.add(target.table);
          if (target.verb === 'index') {
            const named = /\bindex\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_$]*)"?\s+on\b/i.exec(
              target.statement,
            );
            if (named !== null) indexTables.set(named[1]!.toLowerCase(), target.table);
          }
        }
        runs.push({ pkg, migration: cls.name, method, targets });
      }
    }
  }

  const findings: ForeignWriteFinding[] = [];
  const unresolvedIndexes = new Set<string>();
  for (const { pkg, migration, method, targets } of runs) {
    const mine = new Set<string>([
      ...(input.ownTables?.(pkg.id) ?? new Set<string>()),
      ...(input.ownTables === undefined ? tablesOf(driver, pkg.entities) : []),
    ]);
    const own = new Set<string>([...mine, ...[...(created.get(pkg.id) ?? [])].filter((t) => adopts(t, mine, mapped))]);
    const context: ForeignSchemaGuardContext = {
      moduleId: pkg.id,
      packageName: pkg.packageName,
      entities: pkg.entities,
      platformEntities: input.platformEntities,
      declaredHosts: declaredColumnsByHost(pkg.schemaExtensions ?? []),
      exemptions: input.exemptions,
      moduleMigrations: () => [],
      ...(input.reverseEdges === undefined
        ? {}
        : {
            reverseEdges: {
              ownerOf: input.reverseEdges.ownerOf,
              clause: (owner: string) => input.reverseEdges!.clause(pkg.id, owner),
            },
          }),
    };
    // Both halves of one migration are "the same source" (R2's reading) — except
    // that in `up()` a `create table if not exists` on a table another module's
    // entity maps licenses nothing (review finding 3), as in the guard.
    const createdHere = new Set(
      runs
        .filter((other) => other.pkg === pkg && other.migration === migration && (method === 'down' || other.method === 'up'))
        .flatMap((other) => other.targets)
        .filter(
          (target) =>
            target.verb === 'create' &&
            target.table !== null &&
            (method === 'down' || target.ifNotExists !== true || adopts(target.table, mine, mapped)),
        )
        .map((target) => target.table!),
    );
    for (const target of targets) {
      if (target.verb === 'create') continue;
      if (target.verb === 'dynamic') {
        findings.push({ packageName: pkg.packageName, moduleId: pkg.id, migration, method, table: DYNAMIC_SQL, statement: target.statement });
        continue;
      }
      let table = target.table;
      if (table === null && target.index !== undefined) {
        table = indexTables.get(target.index) ?? null;
        if (table === null) unresolvedIndexes.add(target.index);
      }
      if (table === null) continue;
      const destroyed = destructionRefused(
        context,
        migration,
        mine,
        mapped,
        { ...target, table },
        method,
        input.reverseEdges?.ownerOf,
      );
      if (destroyed === EXEMPT) continue;
      if (destroyed !== null) {
        findings.push({ packageName: pkg.packageName, moduleId: pkg.id, migration, method, table: destroyed, statement: target.statement });
        continue;
      }
      const refused = verdictOn(context, migration, own, platform, { ...target, table }, createdHere);
      if (refused !== null) {
        findings.push({ packageName: pkg.packageName, moduleId: pkg.id, migration, method, table: refused, statement: target.statement });
      }
    }
  }
  return {
    findings,
    migrations: runs.length / 2,
    statements,
    unresolvedIndexes: [...unresolvedIndexes].sort(),
    dryRunErrors,
  };
}
