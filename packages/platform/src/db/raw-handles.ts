/**
 * Issue #1889 — the raw database handles a guarded package migration can reach,
 * sealed, for `foreign-schema-guard.ts`.
 *
 * A sealed handle is a proxy over an empty target that answers **only** the
 * members it lists. Everything else is refused — on access, not on call — and
 * reflection (`Object.keys`, `getOwnPropertyDescriptor`) sees nothing, so a
 * member the list does not name cannot pass a raw handle through, whatever a
 * later MikroORM version adds (fail closed). A member that runs SQL judges the
 * statement first; a transaction is handed out sealed and turned back into the
 * real one only where it re-enters the ORM as a transaction context.
 *
 * MikroORM 7 (#1866) offers kysely: `getClient()` on a connection is refused
 * by the allowlist like every other member it does not list, and `getKysely()`
 * on an entity manager is the entry in {@link RAW_BUILDER_HANDLES}.
 */

/**
 * The query-builder handles an entity manager offers: kysely, on MikroORM 7
 * (#1866). Each is refused on a guarded entity manager, and the same names are
 * refused on a guarded migration, whose MikroORM 7 base class offers no builder
 * of its own — a migration builds SQL as text, a `raw()` fragment or a native
 * query builder for `addSql`, which judges what it renders. MikroORM 6's
 * `getKnex()` is gone with the major, and with it the connectionless knex
 * builder a migration was offered in its place.
 */
export const RAW_BUILDER_HANDLES = ['getKysely'] as const;
export type RawBuilderHandle = (typeof RAW_BUILDER_HANDLES)[number];

/**
 * A migration's {@link RAW_BUILDER_HANDLES}: each throws `refusal(handle)`, so a
 * builder a later MikroORM puts on `Migration` under one of these names is
 * shadowed by a refusal rather than offered (fail closed).
 */
export function migrationBuilders(refusal: (handle: RawBuilderHandle) => Error): Record<RawBuilderHandle, () => never> {
  return Object.fromEntries(
    RAW_BUILDER_HANDLES.map((handle) => [
      handle,
      (): never => {
        throw refusal(handle);
      },
    ]),
  ) as Record<RawBuilderHandle, () => never>;
}

/** What a sealed handle needs from the guard. */
export interface SealHooks {
  /** Judges a statement as `execute(query, params)` would send it; rejects to refuse. */
  readonly judgeStatement: (query: unknown, params: readonly unknown[] | undefined) => Promise<void>;
  /** Judges a write the driver performs by entity rather than by text; rejects to refuse. */
  readonly judgeTable: (table: string, verb: 'insert' | 'update', statement: string) => Promise<void>;
  /** The refusal of a handle nothing here can judge. */
  readonly refuse: (what: string) => Error;
  /** Holds an entity manager the driver creates to the verdict, and returns it. */
  readonly guardEntityManager: <T>(em: T) => T;
}

type Fn = (...args: unknown[]) => unknown;

/** `real.name` bound to `real`, or nothing when `real` has no such method. */
function method(real: unknown, name: string): Fn | undefined {
  const value = (real as Record<string, unknown> | null | undefined)?.[name];
  return typeof value === 'function' ? (value as Fn).bind(real) : undefined;
}

/** Members with no implementation are left out, so accessing them is refused. */
function present(members: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(members).filter(([, value]) => value !== undefined));
}

/**
 * A proxy answering `members` and refusing every other string property.
 * `then` reads as absent, so a sealed handle can be returned from an async
 * function without being taken for a promise.
 */
export function sealedHandle(label: string, members: Record<string, unknown>, refuse: (what: string) => Error): object {
  const offered = present(members);
  const refused = (property: string | symbol): never => {
    throw refuse(`${label}.${String(property)}`);
  };
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (typeof property === 'symbol' || property === 'then') return undefined;
      if (Object.hasOwn(offered, property)) return offered[property];
      return refused(property);
    },
    has: (_target, property) => typeof property === 'string' && Object.hasOwn(offered, property),
    set: (_target, property) => refused(property),
    defineProperty: (_target, property) => refused(property),
    deleteProperty: (_target, property) => refused(property),
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => undefined,
    getPrototypeOf: () => null,
  });
}

/** sealed transaction → the real one, for where it re-enters the ORM. */
const REAL_TRANSACTIONS = new WeakMap<object, unknown>();

/** The real transaction behind `value` when it is a sealed one, else `value`. */
export function unsealed<T>(value: T): T {
  if ((typeof value === 'object' || typeof value === 'function') && value !== null && REAL_TRANSACTIONS.has(value)) {
    return REAL_TRANSACTIONS.get(value) as T;
  }
  return value;
}

const unsealedOptions = (options: unknown): unknown =>
  options !== null && typeof options === 'object' && 'ctx' in options
    ? { ...(options as Record<string, unknown>), ctx: unsealed((options as { ctx: unknown }).ctx) }
    : options;

/**
 * Seals transactions for one guard: the same real transaction always seals to
 * the same handle. A sealed transaction offers nothing — calling it, any member,
 * reflection — and works only as a transaction context handed back to a sealed
 * connection, a sealed driver or a guarded entity manager.
 */
export function transactionSealer(label: string, refuse: (what: string) => Error): <T>(trx: T) => T {
  const sealedOf = new WeakMap<object, object>();
  return <T>(trx: T): T => {
    if ((typeof trx !== 'object' && typeof trx !== 'function') || trx === null) return trx;
    if (REAL_TRANSACTIONS.has(trx)) return trx;
    const existing = sealedOf.get(trx);
    if (existing !== undefined) return existing as T;
    const refused = (what: string): never => {
      throw refuse(`${label}${what}`);
    };
    // An arrow function: callable, so `apply` traps, with no non-configurable own property to answer for.
    const target = (() => undefined) as unknown as object;
    const sealed = new Proxy(target, {
      get(_target, property) {
        if (typeof property === 'symbol' || property === 'then') return undefined;
        return refused(`.${property}`);
      },
      apply: () => refused('(…)'),
      has: () => false,
      set: (_target, property) => refused(`.${String(property)}`),
      defineProperty: (_target, property) => refused(`.${String(property)}`),
      deleteProperty: (_target, property) => refused(`.${String(property)}`),
      ownKeys: () => [],
      getOwnPropertyDescriptor: () => undefined,
    });
    REAL_TRANSACTIONS.set(sealed, trx);
    sealedOf.set(trx, sealed);
    return sealed as T;
  };
}

/** `execute(query, params, method, ctx, …)` judged, on the real transaction. */
function judgedExecute(real: unknown, hooks: SealHooks): Fn | undefined {
  const execute = method(real, 'execute');
  if (execute === undefined) return undefined;
  return async (query: unknown, params?: unknown, ...rest: unknown[]) => {
    await hooks.judgeStatement(query, params as readonly unknown[] | undefined);
    const [how, ctx, ...tail] = rest;
    return execute(query, params, how, unsealed(ctx), ...tail);
  };
}

/**
 * A connection offering its platform, judged `execute`, and transactions that
 * are handed out sealed. Its kysely client (`getClient()`), `loadFile()`,
 * `executeDump()` and the rest are refused.
 */
export function sealConnection(connection: unknown, label: string, hooks: SealHooks): object {
  const seal = transactionSealer(`a transaction of ${label}`, hooks.refuse);
  const transactional = method(connection, 'transactional');
  const begin = method(connection, 'begin');
  const commit = method(connection, 'commit');
  const rollback = method(connection, 'rollback');
  return sealedHandle(
    label,
    {
      getPlatform: method(connection, 'getPlatform'),
      execute: judgedExecute(connection, hooks),
      transactional:
        transactional &&
        ((cb: (trx: unknown) => unknown, options?: unknown, ...rest: unknown[]) =>
          transactional((trx: unknown) => cb(seal(trx)), unsealedOptions(options), ...rest)),
      begin: begin && (async (options?: unknown, ...rest: unknown[]) => seal(await begin(unsealedOptions(options), ...rest))),
      commit: commit && ((ctx: unknown, ...rest: unknown[]) => commit(unsealed(ctx), ...rest)),
      rollback: rollback && ((ctx: unknown, ...rest: unknown[]) => rollback(unsealed(ctx), ...rest)),
    },
    hooks.refuse,
  );
}

interface CollectionLike {
  readonly property?: { readonly kind?: string; readonly type?: unknown; readonly pivotEntity?: unknown };
}

/**
 * The driver's members that answer metadata and platform questions — all a dry
 * run offers.
 */
export function driverMetadataMembers(driver: unknown): Record<string, unknown> {
  return {
    getPlatform: method(driver, 'getPlatform'),
    getMetadata: method(driver, 'getMetadata'),
  };
}

/**
 * A driver offering metadata, judged `execute`, a sealed connection, guarded
 * entity managers, and the members a guarded entity manager's own flush and
 * loading call on it: `syncCollections` (judged by the table it writes),
 * `lockPessimistic` and `loadFromPivotTable` (reads). Every other member —
 * `native*`, `find*`, `connection`, `createQueryBuilder` — is refused.
 */
export function sealDriver(driver: unknown, label: string, hooks: SealHooks): object {
  const getConnection = method(driver, 'getConnection');
  const createEntityManager = method(driver, 'createEntityManager');
  const syncCollections = method(driver, 'syncCollections');
  const lockPessimistic = method(driver, 'lockPessimistic');
  const loadFromPivotTable = method(driver, 'loadFromPivotTable');
  const tableOf = (entity: unknown): string | undefined => {
    const meta = (driver as { getMetadata(): { find(name: unknown): { tableName?: string; collection?: string } | undefined } })
      .getMetadata()
      .find(entity);
    return (meta?.tableName ?? meta?.collection)?.toLowerCase();
  };
  return sealedHandle(
    label,
    {
      ...driverMetadataMembers(driver),
      execute: judgedExecute(driver, hooks),
      getConnection:
        getConnection && ((...args: unknown[]) => sealConnection(getConnection(...args), `${label}.getConnection()`, hooks)),
      createEntityManager: createEntityManager && ((...args: unknown[]) => hooks.guardEntityManager(createEntityManager(...args))),
      syncCollections:
        syncCollections &&
        (async (collections: Iterable<CollectionLike>, options?: unknown) => {
          for (const collection of collections) {
            const property = collection.property;
            const oneToMany = property?.kind === '1:m';
            const table = tableOf(oneToMany ? property?.type : property?.pivotEntity);
            if (table === undefined) throw hooks.refuse(`${label}.syncCollections() on a collection it cannot attribute`);
            await hooks.judgeTable(table, oneToMany ? 'update' : 'insert', `syncCollections ${table}`);
          }
          return syncCollections(collections, unsealedOptions(options));
        }),
      lockPessimistic: lockPessimistic && ((entity: unknown, options?: unknown) => lockPessimistic(entity, unsealedOptions(options))),
      loadFromPivotTable:
        loadFromPivotTable &&
        ((prop: unknown, owners: unknown, where: unknown, orderBy: unknown, ctx: unknown, ...rest: unknown[]) =>
          loadFromPivotTable(prop, owners, where, orderBy, unsealed(ctx), ...rest)),
    },
    hooks.refuse,
  );
}
