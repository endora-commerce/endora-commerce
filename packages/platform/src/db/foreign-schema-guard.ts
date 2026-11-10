import type { EntityManager, EntityName } from '@mikro-orm/core';
import type { Migration } from '@mikro-orm/migrations';
import { sqlWriteTargets, type SqlWriteTarget } from './sql-statement-targets.js';

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
}

export interface ForeignSchemaGuardContext {
  readonly moduleId: string;
  readonly packageName: string;
  /** The package's entity classes — their tables are its own. */
  readonly entities: readonly unknown[];
  /** The platform's entity classes — their tables are allowed (R2's kernel exclusion). */
  readonly platformEntities: readonly unknown[];
  /** Hosts the module declares extension columns on → its own column prefix. */
  readonly declaredHosts: ReadonlyMap<string, string>;
  readonly exemptions: readonly ForeignWriteExemption[];
  /** Every migration class of the module, raw — the dry run's population. */
  readonly moduleMigrations: () => readonly MigrationClass[];
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
  getMetadata(): { getAll(): Record<string, MetadataLike> };
}

/** Tables the classes in `classes` map, by the ORM's discovered metadata. */
function tablesOf(driver: DriverLike, classes: readonly unknown[]): Set<string> {
  const wanted = new Set(classes);
  const names = new Set(
    classes.map((cls) => (typeof cls === 'function' ? (cls as { name: string }).name : undefined)),
  );
  const tables = new Set<string>();
  for (const meta of Object.values(driver.getMetadata().getAll())) {
    if (!wanted.has(meta.class) && !names.has(meta.className)) continue;
    const table = meta.tableName ?? meta.collection;
    if (table !== undefined) tables.add(table.toLowerCase());
  }
  return tables;
}

/** Every table some discovered entity maps — the tables a `create table` cannot make one's own. */
function mappedTables(driver: DriverLike): Set<string> {
  const tables = new Set<string>();
  for (const meta of Object.values(driver.getMetadata().getAll())) {
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

/** A query as `addSql` / `execute` accept it, rendered to text. */
export function queryText(query: unknown): string {
  if (typeof query === 'string') return query;
  if (query !== null && typeof query === 'object') {
    const candidate = query as { toQuery?: () => string; toString?: () => string };
    if (typeof candidate.toQuery === 'function') return candidate.toQuery();
    if (typeof candidate.toString === 'function') return candidate.toString();
  }
  return String(query);
}

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
  const instance = new Ctor(driver, config);
  const executed: string[] = [];
  Object.assign(instance, {
    execute: async (sql: unknown) => {
      executed.push(queryText(sql));
      return [];
    },
    getEntityManager: () => {
      throw new Error('[foreign-schema-guard] the entity manager is not available in a dry run');
    },
  });
  let error: unknown = null;
  try {
    await instance[method]();
  } catch (caught) {
    error = caught;
  }
  return { statements: [...executed, ...instance.getQueries().map(queryText)], error };
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
const DDL_VERBS = new Set(['alter', 'index', 'drop', 'drop-index', 'comment', 'trigger', 'rule']);

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
  const prefix = context.declaredHosts.get(table);
  if (
    prefix !== undefined &&
    target.verb === 'update' &&
    target.setColumns !== null &&
    target.setColumns !== undefined &&
    target.setColumns.length > 0 &&
    target.setColumns.every((column) => column.startsWith(prefix))
  ) {
    return null;
  }
  if (
    context.exemptions.some(
      (exemption) =>
        exemption.moduleId === context.moduleId && exemption.migration === migration && exemption.table === table,
    )
  ) {
    return null;
  }
  return table;
}

/**
 * `cls` with every statement it issues judged before it runs. Same `name`, so
 * the migration table and the ordering see the package's own class.
 */
export function guardExternalMigration<T extends MigrationClass>(cls: T, context: ForeignSchemaGuardContext): T {
  const migrationName = cls.name;
  const Base = cls as unknown as new (...args: unknown[]) => Migration;

  class GuardedMigration extends Base {
    #platform: Set<string> | null = null;
    #createdIndexes = new Map<string, string>();
    #createdHere = new Set<string>();

    async #own(): Promise<Set<string>> {
      const state = stateOf(context);
      if (state.own === null) {
        const driver = (this as unknown as { driver: DriverLike }).driver;
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
      this.#platform ??= tablesOf((this as unknown as { driver: DriverLike }).driver, context.platformEntities);
      return this.#platform;
    }

    async #indexTable(index: string): Promise<string | null> {
      const created = this.#createdIndexes.get(index);
      if (created !== undefined) return created;
      const rows = (await super.execute(
        `select tablename from pg_indexes where schemaname = current_schema() and indexname = ?`,
        [index],
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
            this.#createdHere.add(target.table);
            if (adopts(target.table, state.mine, state.mapped)) own.add(target.table);
          }
          continue;
        }
        if (target.verb === 'index' && target.table !== null) {
          const named = /\bindex\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_$]*)"?\s+on\b/i.exec(
            target.statement,
          );
          if (named !== null) this.#createdIndexes.set(named[1]!.toLowerCase(), target.table);
        }
        const table = target.table ?? (target.index === undefined ? null : await this.#indexTable(target.index));
        if (table === null) continue;
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
      const queued = this.getQueries().map(queryText);
      // The whole migration's `create table`s first: R2 reads "the same source
      // creates" over the file, not up to the statement.
      for (const sql of queued) {
        for (const target of sqlWriteTargets(sql)) {
          if (target.verb === 'create' && target.table !== null) this.#createdHere.add(target.table);
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
      await super.down();
      // "The same source" is the migration, both halves: the tables its `up()`
      // creates are the ones its `down()` may drop (R2's reading).
      const driver = (this as unknown as { driver: unknown }).driver;
      const config = (this as unknown as { config: unknown }).config;
      for (const statement of (await dryRunStatements(cls, driver, config, 'up')).statements) {
        for (const target of sqlWriteTargets(statement)) {
          if (target.verb === 'create' && target.table !== null) this.#createdHere.add(target.table);
        }
      }
      await this.#judgeQueued();
    }

    override async execute(sql: Parameters<Migration['execute']>[0], params?: unknown[]) {
      await this.#judge(queryText(sql));
      return super.execute(sql, params);
    }

    override getEntityManager(): ReturnType<Migration['getEntityManager']> {
      const em = super.getEntityManager();
      const guarded = em as unknown as { [GUARDED]?: true };
      if (guarded[GUARDED] === true) return em;
      guardEntityManager(em as unknown as EntityManager, (target) => this.#judgeTarget(target), (sql) => this.#judge(sql));
      guarded[GUARDED] = true;
      return em;
    }

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

/**
 * Hold a migration's entity manager to the statement verdict (OD-178-3): its
 * flush, by change set, and the shortcuts that bypass the unit of work.
 */
function guardEntityManager(em: EntityManager, judge: TargetJudge, judgeSql: (sql: string) => Promise<void>): void {
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
        await judgeSql(queryText(sql));
        return execute.call(em, sql, ...rest);
      },
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
  readonly schemaExtensions?: readonly { readonly host: string; readonly module: string }[];
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
      declaredHosts: new Map((pkg.schemaExtensions ?? []).map((d) => [d.host, `x_${d.module}_`] as const)),
      exemptions: input.exemptions,
      moduleMigrations: () => [],
    };
    // Both halves of one migration are "the same source" (R2's reading).
    const createdHere = new Set(
      runs
        .filter((other) => other.pkg === pkg && other.migration === migration)
        .flatMap((other) => other.targets)
        .filter((target) => target.verb === 'create' && target.table !== null)
        .map((target) => target.table!),
    );
    for (const target of targets) {
      if (target.verb === 'create') continue;
      let table = target.table;
      if (table === null && target.index !== undefined) {
        table = indexTables.get(target.index) ?? null;
        if (table === null) unresolvedIndexes.add(target.index);
      }
      if (table === null) continue;
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
