import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * One statement the ORM's connection ran: its text and its parameters, as
 * `Connection.executeQuery` logs them — `sql` keeps its `?` placeholders while
 * query logging is off, which it is in the harness, and `params` carries the
 * values beside it.
 */
export interface TappedStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

type LogQuery = (context: { query?: string; params?: unknown[] }) => void;

interface Tapped {
  readonly listeners: Set<(statement: TappedStatement) => void>;
  readonly original: LogQuery;
  /** Whether `logQuery` was the logger's own property, or its prototype's. */
  readonly own: boolean;
}

const TAPPED = new WeakMap<object, Tapped>();

/**
 * Observe every statement `em`'s connection runs until the returned function
 * is called (issue #1864).
 *
 * The statement counts and the statement-shape assertions used to listen on
 * the knex client's `query` event, which MikroORM 7 no longer has. This taps
 * the ORM logger's `logQuery` instead — the one call every statement, `begin`
 * and `commit` included, passes through on the connection, whether or not
 * query logging is enabled — so it reads the same population on either
 * driver. Taps nest; the logger is restored when the last one is removed.
 */
export function tapStatements(
  em: EntityManager,
  listener: (statement: TappedStatement) => void,
): () => void {
  const logger = em.config.getLogger() as unknown as { logQuery: LogQuery };
  let tapped = TAPPED.get(logger);
  if (tapped === undefined) {
    const original = logger.logQuery;
    const listeners = new Set<(statement: TappedStatement) => void>();
    tapped = { listeners, original, own: Object.prototype.hasOwnProperty.call(logger, 'logQuery') };
    TAPPED.set(logger, tapped);
    logger.logQuery = function tap(this: unknown, context) {
      if (typeof context.query === 'string') {
        const statement: TappedStatement = { sql: context.query, params: context.params ?? [] };
        for (const each of [...listeners]) each(statement);
      }
      return original.call(this, context);
    };
  }
  const own = (statement: TappedStatement): void => listener(statement);
  tapped.listeners.add(own);
  return () => {
    const current = TAPPED.get(logger);
    if (current === undefined) return;
    current.listeners.delete(own);
    if (current.listeners.size === 0) {
      if (current.own) logger.logQuery = current.original;
      else delete (logger as { logQuery?: LogQuery }).logQuery;
      TAPPED.delete(logger);
    }
  };
}

/** The statements `run` causes, in order, and its result. */
export async function statementsDuring<T>(
  em: EntityManager,
  run: () => Promise<T>,
): Promise<{ result: T; statements: TappedStatement[] }> {
  const statements: TappedStatement[] = [];
  const untap = tapStatements(em, (statement) => statements.push(statement));
  try {
    return { result: await run(), statements };
  } finally {
    untap();
  }
}
