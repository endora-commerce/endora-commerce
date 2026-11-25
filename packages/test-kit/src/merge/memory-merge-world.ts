import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command } from '@endora-commerce/platform/commands';
import type { AuditStateCarrier } from '../audit/index.js';

/**
 * An in-memory world for a merge participant's co-located conformance test
 * (`specs/192-organization-merge/` `contracts/merge-participant.md` §3), where a
 * module package has no database: a small EntityManager over arrays and a
 * Command Bus with the two properties `expectMergeParticipant` reads — one
 * audit entry per audited Command, and a whole rollback when `run` throws.
 *
 * It understands what a participant's batch Command needs and nothing more:
 * `find` / `findOne` / `count` with equality, `$in` and `$ne` on top-level
 * properties, `orderBy` and `limit`; `create`, `persist`, `remove` and `flush`.
 * Anything else throws, so a Command that outgrows it fails loudly rather than
 * passing on a fake that ignored a clause. The database-backed proof of the
 * same participant is the backend's integration test.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EntityClass<T = any> = abstract new (...args: any[]) => T;
type Row = Record<string, unknown>;

export interface MemoryAuditEntry extends AuditStateCarrier {
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly stateBefore: Record<string, unknown> | null;
  readonly stateAfter: Record<string, unknown> | null;
}

export interface MemoryMergeWorld {
  /** Insert a row of `entity` directly (a seed, not a Command). */
  insert<T>(entity: EntityClass<T>, values: Partial<T>): T;
  /** The live rows of `entity`. */
  rows<T>(entity: EntityClass<T>): T[];
  readonly emFactory: () => EntityManager;
  readonly commandBus: { run<TResult>(command: Command<TResult>): Promise<TResult> };
  readonly audit: { entries(): readonly MemoryAuditEntry[] };
  /** How many events the Commands run so far declared. */
  events(): number;
  /** While armed, every `flush` throws after the Command's in-memory changes — the bus must roll them back. */
  readonly injectFailure: { arm(): void; disarm(): void };
}

function matches(row: Row, where: Row): boolean {
  for (const [key, condition] of Object.entries(where)) {
    const value = row[key];
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      for (const [operator, operand] of Object.entries(condition as Row)) {
        if (operator === '$in') {
          if (!(operand as unknown[]).includes(value)) return false;
        } else if (operator === '$ne') {
          if (value === operand) return false;
        } else if (operator === '$eq') {
          if (value !== operand) return false;
        } else {
          throw new Error(`memory world: operator ${operator} on ${key} is not supported`);
        }
      }
    } else if ((value ?? null) !== (condition ?? null)) {
      return false;
    }
  }
  return true;
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

export function createMemoryMergeWorld(): MemoryMergeWorld {
  const tables = new Map<EntityClass, Row[]>();
  const audit: MemoryAuditEntry[] = [];
  let events = 0;
  let failing = false;
  let pendingPersist: Row[] = [];
  let pendingRemove: Row[] = [];

  const table = (entity: EntityClass): Row[] => {
    let rows = tables.get(entity);
    if (rows === undefined) {
      rows = [];
      tables.set(entity, rows);
    }
    return rows;
  };
  const tableOf = (row: Row): Row[] => {
    for (const [entity, rows] of tables) if (row instanceof entity) return rows;
    return table(row.constructor as EntityClass);
  };

  const select = (entity: EntityClass, where: Row = {}, options: { orderBy?: Row; limit?: number; offset?: number } = {}): Row[] => {
    let rows = table(entity).filter((row) => matches(row, where));
    if (options.orderBy) {
      const order = Object.entries(options.orderBy);
      rows = [...rows].sort((a, b) => {
        for (const [key, direction] of order) {
          const result = compare(a[key], b[key]);
          if (result !== 0) return String(direction).toLowerCase().startsWith('desc') ? -result : result;
        }
        return 0;
      });
    }
    const offset = options.offset ?? 0;
    return rows.slice(offset, options.limit === undefined ? undefined : offset + options.limit);
  };

  const em = {
    fork: () => em,
    find: async (entity: EntityClass, where?: Row, options?: { orderBy?: Row; limit?: number; offset?: number }) =>
      select(entity, where, options),
    findOne: async (entity: EntityClass, where: Row) => select(entity, where)[0] ?? null,
    count: async (entity: EntityClass, where?: Row) => select(entity, where).length,
    create: (entity: EntityClass, values: Row) => {
      const row = Object.assign(new (entity as unknown as new () => Row)(), values);
      pendingPersist.push(row);
      return row;
    },
    persist: (row: Row | Row[]) => {
      for (const one of Array.isArray(row) ? row : [row]) pendingPersist.push(one);
      return em;
    },
    remove: (row: Row | Row[]) => {
      for (const one of Array.isArray(row) ? row : [row]) pendingRemove.push(one);
      return em;
    },
    flush: async () => {
      if (failing) throw new Error('memory world: injected failure at flush');
      for (const row of pendingPersist) {
        const rows = tableOf(row);
        if (!rows.includes(row)) rows.push(row);
      }
      for (const row of pendingRemove) {
        const rows = tableOf(row);
        const index = rows.indexOf(row);
        if (index >= 0) rows.splice(index, 1);
      }
      pendingPersist = [];
      pendingRemove = [];
    },
  };

  const snapshot = () => [...tables].map(([entity, rows]) => ({ entity, rows: [...rows], values: rows.map((row) => ({ ...row })) }));
  const restore = (picture: ReturnType<typeof snapshot>): void => {
    tables.clear();
    for (const { entity, rows, values } of picture) {
      rows.forEach((row, index) => {
        for (const key of Object.keys(row)) delete row[key];
        Object.assign(row, values[index]);
      });
      tables.set(entity, rows);
    }
    pendingPersist = [];
    pendingRemove = [];
  };

  return {
    insert: (entity, values) => {
      const row = Object.assign(new (entity as unknown as new () => Row)(), values as Row);
      table(entity).push(row);
      return row as never;
    },
    rows: (entity) => table(entity) as never,
    emFactory: () => em as unknown as EntityManager,
    commandBus: {
      async run<TResult>(command: Command<TResult>): Promise<TResult> {
        const picture = snapshot();
        try {
          const context = {
            em: em as unknown as EntityManager,
            actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, actorCustomerAccountId: null, kind: 'system' as const },
          };
          const captured = command.capture ? await command.capture(context) : null;
          const outcome = await command.run(context);
          await em.flush();
          if (!outcome.skipAudit) {
            audit.push({
              action: command.action,
              objectType: command.objectType,
              objectId: command.objectId,
              stateBefore: outcome.before !== undefined ? outcome.before : captured,
              stateAfter: outcome.after ?? null,
            });
          }
          if (command.event?.(outcome.result) !== undefined) events += 1;
          return outcome.result;
        } catch (error) {
          restore(picture);
          throw error;
        }
      },
    },
    audit: { entries: () => [...audit] },
    events: () => events,
    injectFailure: {
      arm: () => {
        failing = true;
      },
      disarm: () => {
        failing = false;
      },
    },
  };
}
