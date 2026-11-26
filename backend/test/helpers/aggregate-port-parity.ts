import type { EntityManager } from '@mikro-orm/postgresql';
import { expect } from 'vitest';

/**
 * Parity between an admin route and an aggregate write port
 * (`specs/186-aggregate-ports/` T015, FR-002, FR-013; research R-3).
 *
 * Each `<aggregate>CommandPort` method runs the Command its admin route runs, so
 * a parity test performs one operation twice — once through the route, once
 * through the port, on two objects in the same state — and holds what each
 * wrote to the other. {@link expectPortParity} is that comparison;
 * {@link observeWrite} is the measurement of one path against PostgreSQL.
 *
 * What has to match:
 *
 * - **the audit entries** the write added, in order: the same action and object
 *   type, and the same *shape* of `stateBefore` / `stateAfter` — the keys and
 *   the kind of each value, never the values, which name two different
 *   objects. The actor is not compared (a port call may run under the system
 *   actor), and neither is `stateAfter.source`, which only a port call can set
 *   (D-293.6);
 * - **the command hooks fired**, in order, as the caller's recorder names them;
 * - **the outbox rows written**: action, object type, hook module, hook id and
 *   the shape of the row's data;
 * - **the side effects**, through a probe the caller supplies — a notice sent, a
 *   cache dropped, an event emitted — compared by value.
 *
 * Both paths writing nothing is refused rather than passed: an operation whose
 * audit entry went missing on both sides would otherwise look like parity.
 */

/** One audit entry as the comparison reads it. */
export interface ParityAuditEntry {
  readonly action: string;
  readonly objectType: string;
  readonly objectId?: string;
  readonly actorAdminUserId?: string | null;
  readonly stateBefore: Record<string, unknown> | null | undefined;
  readonly stateAfter: Record<string, unknown> | null | undefined;
}

/** One `command_outbox` row as the comparison reads it. */
export interface ParityOutboxRow {
  readonly action: string;
  readonly objectType: string;
  readonly hookModule: string;
  readonly hookId: string;
  readonly data: Record<string, unknown>;
}

/** What one path of the operation added. */
export interface ParityObservation {
  readonly audit: readonly ParityAuditEntry[];
  readonly hooks: readonly string[];
  readonly outbox: readonly ParityOutboxRow[];
  /** What the caller's probe answered; compared with `toEqual`. Omitted ⇒ nothing to compare. */
  readonly sideEffects?: unknown;
}

export interface PortParityInput {
  /** The operation through the admin route, answering what it added. */
  readonly viaRoute: () => Promise<ParityObservation>;
  /** The same operation through the port, on a second object in the same state. */
  readonly viaPort: () => Promise<ParityObservation>;
}

/** The kind of a JSON value, recursively: object keys and array elements kept, values dropped. */
export type ValueShape =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | { readonly array: readonly ValueShape[] }
  | { readonly object: Readonly<Record<string, ValueShape>> };

/** The key `stateAfter` records a port caller's source code under (research R-4). */
const SOURCE_KEY = 'source';

/** {@link ValueShape} of a value; object keys sorted so key order never matters. */
export function shapeOf(value: unknown): ValueShape {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return { array: value.map(shapeOf) };
  if (value instanceof Date) return 'string';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
    case 'bigint':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object': {
      const object: Record<string, ValueShape> = {};
      for (const key of Object.keys(value as object).sort()) {
        object[key] = shapeOf((value as Record<string, unknown>)[key]);
      }
      return { object };
    }
    default:
      throw new Error(`aggregate-port-parity: ${typeof value} is not a value an audit state can hold.`);
  }
}

/** `stateAfter` without the port caller's `source`, as a shape. */
function afterShape(state: Record<string, unknown> | null | undefined): ValueShape {
  if (state === null || state === undefined) return 'null';
  const { [SOURCE_KEY]: _source, ...rest } = state;
  return shapeOf(rest);
}

/** What the comparison holds equal, for one observation. */
export function parityView(observation: ParityObservation): {
  audit: Array<{ action: string; objectType: string; stateBefore: ValueShape; stateAfter: ValueShape }>;
  hooks: string[];
  outbox: Array<{ action: string; objectType: string; hookModule: string; hookId: string; data: ValueShape }>;
} {
  return {
    audit: observation.audit.map((entry) => ({
      action: entry.action,
      objectType: entry.objectType,
      stateBefore: entry.stateBefore === null || entry.stateBefore === undefined ? 'null' : shapeOf(entry.stateBefore),
      stateAfter: afterShape(entry.stateAfter),
    })),
    hooks: [...observation.hooks],
    outbox: observation.outbox.map((row) => ({
      action: row.action,
      objectType: row.objectType,
      hookModule: row.hookModule,
      hookId: row.hookId,
      data: shapeOf(row.data),
    })),
  };
}

/**
 * Runs both paths, route first, and asserts they wrote the same thing. Answers
 * both observations, for a test that goes on to check the values it cares
 * about (the action, a `source` code).
 */
export async function expectPortParity(
  input: PortParityInput,
): Promise<{ route: ParityObservation; port: ParityObservation }> {
  const route = await input.viaRoute();
  const port = await input.viaPort();
  expect(
    route.audit.length,
    'aggregate-port-parity: the route wrote no audit entry, so there is nothing for the port to match',
  ).toBeGreaterThan(0);
  const [routeView, portView] = [parityView(route), parityView(port)];
  expect(portView.audit, 'aggregate-port-parity: audit entries').toEqual(routeView.audit);
  expect(portView.hooks, 'aggregate-port-parity: command hooks fired').toEqual(routeView.hooks);
  expect(portView.outbox, 'aggregate-port-parity: outbox rows written').toEqual(routeView.outbox);
  expect(port.sideEffects, 'aggregate-port-parity: side effects').toEqual(route.sideEffects);
  return { route, port };
}

export interface ObserveWriteOptions<T> {
  /** A fresh EntityManager; the audit and outbox rows are read on it. */
  readonly em: () => EntityManager;
  readonly objectType: string;
  /**
   * The object the write is about — or, for a create, how to read its id off
   * the write's result (nothing is recorded for an id before it exists).
   */
  readonly objectId: string | ((result: T) => string);
  /** The hooks fired so far, as the caller's recording hook names them. */
  readonly hooks?: () => readonly string[];
  /** Reads a side effect after the write; its answer is {@link ParityObservation.sideEffects}. */
  readonly probe?: (result: T) => unknown;
}

interface AuditRow {
  id: string;
  action: string;
  object_type: string;
  object_id: string;
  actor_admin_user_id: string | null;
  state_before: Record<string, unknown> | string | null;
  state_after: Record<string, unknown> | string | null;
}

interface OutboxRowRecord {
  id: string;
  action: string;
  object_type: string;
  hook_module: string;
  hook_id: string;
  data: Record<string, unknown> | string;
}

const json = <V>(value: V | string): V => (typeof value === 'string' ? (JSON.parse(value) as V) : value);

async function auditRows(em: EntityManager, objectType: string, objectId: string): Promise<AuditRow[]> {
  return em
    .getConnection()
    .execute<AuditRow[]>(
      'select "id", "action", "object_type", "object_id", "actor_admin_user_id", "state_before", "state_after" ' +
        'from "audit_log_entries" where "object_type" = ? and "object_id" = ? order by "acted_at" asc, "id" asc',
      [objectType, objectId],
    );
}

async function outboxRows(em: EntityManager, objectType: string, objectId: string): Promise<OutboxRowRecord[]> {
  return em
    .getConnection()
    .execute<OutboxRowRecord[]>(
      'select "id", "action", "object_type", "hook_module", "hook_id", "data" from "command_outbox" ' +
        'where "object_type" = ? and "object_id" = ? order by "created_at" asc, "id" asc',
      [objectType, objectId],
    );
}

/**
 * Runs `write` and answers what it added for its object: the audit entries and
 * outbox rows that were not there before, the hooks the recorder gained, and
 * the probe's answer. Entries of other object types — a child Command's, the
 * membership writer's — are not read; a test that cares about them probes.
 */
export async function observeWrite<T>(
  options: ObserveWriteOptions<T>,
  write: () => Promise<T>,
): Promise<{ result: T; observation: ParityObservation }> {
  const knownId = typeof options.objectId === 'string' ? options.objectId : null;
  const seenAudit = new Set(knownId ? (await auditRows(options.em(), options.objectType, knownId)).map((r) => r.id) : []);
  const seenOutbox = new Set(
    knownId ? (await outboxRows(options.em(), options.objectType, knownId)).map((r) => r.id) : [],
  );
  const hooksBefore = options.hooks?.().length ?? 0;

  const result = await write();

  const objectId = typeof options.objectId === 'string' ? options.objectId : options.objectId(result);
  const em = options.em();
  const audit = (await auditRows(em, options.objectType, objectId))
    .filter((row) => !seenAudit.has(row.id))
    .map((row) => ({
      action: row.action,
      objectType: row.object_type,
      objectId: row.object_id,
      actorAdminUserId: row.actor_admin_user_id,
      stateBefore: row.state_before === null ? null : json<Record<string, unknown>>(row.state_before),
      stateAfter: row.state_after === null ? null : json<Record<string, unknown>>(row.state_after),
    }));
  const outbox = (await outboxRows(em, options.objectType, objectId))
    .filter((row) => !seenOutbox.has(row.id))
    .map((row) => ({
      action: row.action,
      objectType: row.object_type,
      hookModule: row.hook_module,
      hookId: row.hook_id,
      data: json<Record<string, unknown>>(row.data),
    }));
  const hooks = options.hooks ? options.hooks().slice(hooksBefore) : [];
  const observation: ParityObservation = {
    audit,
    hooks,
    outbox,
    ...(options.probe ? { sideEffects: await options.probe(result) } : {}),
  };
  return { result, observation };
}
