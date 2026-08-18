import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CommandBus } from '../../../commands/index.js';
import { OrderStatus } from '../entities/order-status.entity.js';
import { OrderStatusTransition } from '../entities/order-status-transition.entity.js';
import { Order } from '../entities/order.entity.js';
import {
  materializeUniversalTransitions,
  ORDER_STATUS_INITIAL,
  OrderStatusConfigError,
  OrderStatusGraph,
  type OrderStatusDef,
  type OrderTransitionDef,
} from '../domain/order-status-graph.js';

/**
 * OrderStatusGraphService — feature 038 (US1, T023).
 *
 * DB-backed loader + admin CRUD for the configurable lifecycle. Builds an
 * immutable `OrderStatusGraph` from `order_statuses` + `order_status_transitions`
 * and caches it in-process; every mutation invalidates the cache. (Cross-process
 * invalidation via the Redis lifecycle channel is a follow-up; a single backend
 * process is correct today.)
 *
 * `OrderStatusRegistry` (features 034/035) can delegate `has()`/`list()` here so
 * payment/shipment `statusOn*` references validate against the configurable set.
 */
export class OrderStatusGraphService {
  private cached: OrderStatusGraph | null = null;

  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits status-graph writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
  ) {}

  invalidate(): void {
    this.cached = null;
  }

  /** Feature 054 — run a status-graph write through the Command Bus. */
  async #audited<T>(
    action: string,
    objectId: string,
    write: (em: EntityManager) => Promise<{
      result: T;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>,
  ): Promise<T> {
    let out: T;
    if (this.commandBus) {
      out = await this.commandBus.run({ action, objectType: 'order_status', objectId, run: ({ em }) => write(em) });
    } else {
      const em = this.emFactory();
      const w = await write(em);
      await em.flush();
      out = w.result;
    }
    this.invalidate();
    return out;
  }

  /** Build (or return cached) the validated graph. */
  async loadGraph(): Promise<OrderStatusGraph> {
    if (this.cached) return this.cached;
    const em = this.emFactory();
    const [statuses, transitions] = await Promise.all([
      em.find(OrderStatus, {}, { orderBy: { weight: 'asc' } }),
      em.find(OrderStatusTransition, {}),
    ]);
    const graph = new OrderStatusGraph(
      statuses.map(toStatusDef),
      transitions.map((t) => ({
        fromStatusCode: t.fromStatusCode,
        toStatusCode: t.toStatusCode,
        isSystem: t.isSystem,
      })),
    );
    this.cached = graph;
    return graph;
  }

  /** True when `code` is a configured status — for the OrderStatusRegistry port. */
  async hasStatus(code: string): Promise<boolean> {
    return (await this.loadGraph()).has(code);
  }

  /** The graph plus per-status `inUseCount` for the admin config view. */
  async listGraph(): Promise<{
    statuses: Array<OrderStatusDef & { inUseCount: number }>;
    transitions: OrderTransitionDef[];
  }> {
    const graph = await this.loadGraph();
    const counts = await this.statusUsageCounts();
    return {
      statuses: graph.statuses.map((s) => ({ ...s, inUseCount: counts.get(s.code) ?? 0 })),
      transitions: graph.transitions,
    };
  }

  private async statusUsageCounts(): Promise<Map<string, number>> {
    const em = this.emFactory();
    // `em.execute`, not `em.getKnex()`: a knex handle takes its own pooled
    // connection, so the in-use counts would be read from outside a transaction
    // the caller holds open — a status the same transaction has just moved an
    // order off would still look in use (issue #207).
    const rows = (await em.execute(
      `select status, count(*) as count from orders group by status`,
    )) as Array<{ status: string; count: string }>;
    return new Map(rows.map((r) => [r.status, Number(r.count)]));
  }

  async createStatus(input: {
    code: string;
    name: Record<string, string>;
    defaultName: string;
    isTerminal?: boolean | undefined;
    weight?: number | undefined;
    color?: string | undefined;
  }): Promise<void> {
    await this.#audited('order_status.create', input.code, async (em) => {
      const existing = await em.findOne(OrderStatus, { code: input.code });
      if (existing) {
        throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, `Status "${input.code}" already exists.`);
      }
      const status = em.create(OrderStatus, {
        code: input.code,
        name: input.name,
        defaultName: input.defaultName,
        isInitial: false,
        isTerminal: input.isTerminal ?? false,
        isSystem: false,
        weight: input.weight ?? 100,
        color: input.color ?? 'neutral',
      });
      // Materialize universal on_hold/cancelled edges for the new status so the
      // graph stays complete (data-model.md §2). Only add edges not already present.
      if (!status.isTerminal) {
        await this.ensureUniversalEdges(em);
      }
      return { result: undefined, before: null, after: { code: input.code, defaultName: input.defaultName } };
    });
  }

  async updateStatus(
    code: string,
    patch: {
      name?: Record<string, string> | undefined;
      defaultName?: string | undefined;
      isTerminal?: boolean | undefined;
      weight?: number | undefined;
      color?: string | undefined;
    },
  ): Promise<void> {
    await this.#audited('order_status.update', code, async (em) => {
      const status = await em.findOne(OrderStatus, { code });
      if (!status) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Status "${code}" not found.`);
      const before = {
        name: status.name,
        defaultName: status.defaultName,
        weight: status.weight,
        color: status.color,
        isTerminal: status.isTerminal,
      };
      if (patch.name !== undefined) status.name = patch.name;
      if (patch.defaultName !== undefined) status.defaultName = patch.defaultName;
      if (patch.weight !== undefined) status.weight = patch.weight;
      if (patch.color !== undefined) status.color = patch.color;
      if (patch.isTerminal !== undefined && patch.isTerminal !== status.isTerminal) {
        if (patch.isTerminal) {
          const outgoing = await em.count(OrderStatusTransition, { fromStatusCode: code });
          if (outgoing > 0) {
            throw new HttpError(
              409,
              ERROR_CODES.VALIDATION_FAILED,
              `Cannot mark "${code}" terminal while it has outgoing transitions.`,
            );
          }
        }
        status.isTerminal = patch.isTerminal;
      }
      return {
        result: undefined,
        before,
        after: { defaultName: status.defaultName, weight: status.weight, color: status.color, isTerminal: status.isTerminal },
      };
    });
  }

  async deleteStatus(code: string): Promise<void> {
    await this.#audited('order_status.delete', code, async (em) => {
      const status = await em.findOne(OrderStatus, { code });
      if (!status) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Status "${code}" not found.`);
      if (code === ORDER_STATUS_INITIAL || status.isInitial) {
        throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'The initial status cannot be deleted.');
      }
      if (status.isSystem) {
        throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, `System status "${code}" cannot be deleted.`);
      }
      const inUse = await em.count(Order, { status: code });
      if (inUse > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VALIDATION_FAILED,
          `Cannot delete status "${code}" while ${inUse} order(s) use it.`,
        );
      }
      const edges = await em.find(OrderStatusTransition, {
        $or: [{ fromStatusCode: code }, { toStatusCode: code }],
      });
      em.remove(edges);
      em.remove(status);
      return { result: undefined, before: { code, defaultName: status.defaultName }, after: null };
    });
  }

  async setTransitions(input: {
    add?: Array<{ fromStatusCode: string; toStatusCode: string }> | undefined;
    remove?: Array<{ fromStatusCode: string; toStatusCode: string }> | undefined;
  }): Promise<void> {
    await this.#audited('order_status.set_transitions', 'graph', async (em) => {
      const graph = await this.loadGraph();
      let added = 0;
      let removed = 0;
      for (const edge of input.add ?? []) {
        if (!graph.has(edge.fromStatusCode) || !graph.has(edge.toStatusCode)) {
          throw new HttpError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            `Transition references an unknown status: ${edge.fromStatusCode} → ${edge.toStatusCode}.`,
          );
        }
        if (graph.isTerminal(edge.fromStatusCode)) {
          throw new HttpError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            `Terminal status "${edge.fromStatusCode}" cannot have outgoing transitions.`,
          );
        }
        const exists = await em.findOne(OrderStatusTransition, {
          fromStatusCode: edge.fromStatusCode,
          toStatusCode: edge.toStatusCode,
        });
        if (!exists) {
          em.create(OrderStatusTransition, {
            fromStatusCode: edge.fromStatusCode,
            toStatusCode: edge.toStatusCode,
            isSystem: false,
          });
          added += 1;
        }
      }
      for (const edge of input.remove ?? []) {
        const row = await em.findOne(OrderStatusTransition, {
          fromStatusCode: edge.fromStatusCode,
          toStatusCode: edge.toStatusCode,
        });
        if (row && !row.isSystem) {
          em.remove(row);
          removed += 1;
        }
      }
      return { result: undefined, before: null, after: { added, removed } };
    });
  }

  /** Validate a candidate config (used before persisting structural edits). */
  async assertValid(): Promise<void> {
    try {
      (await this.loadGraph()).assertValid();
    } catch (err) {
      if (err instanceof OrderStatusConfigError) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, err.message);
      }
      throw err;
    }
  }

  /** Insert any missing universal on_hold/cancelled edges for the current status set. */
  private async ensureUniversalEdges(em: EntityManager): Promise<void> {
    const statuses = await em.find(OrderStatus, {});
    const wanted = materializeUniversalTransitions(statuses.map(toStatusDef));
    const present = new Set(
      (await em.find(OrderStatusTransition, {})).map((t) => `${t.fromStatusCode} ${t.toStatusCode}`),
    );
    for (const e of wanted) {
      if (!present.has(`${e.fromStatusCode} ${e.toStatusCode}`)) {
        // Auto-persisted via persistOnCreate; the enclosing command commits it.
        em.create(OrderStatusTransition, {
          fromStatusCode: e.fromStatusCode,
          toStatusCode: e.toStatusCode,
          isSystem: true,
        });
      }
    }
  }
}

function toStatusDef(s: OrderStatus): OrderStatusDef {
  return {
    code: s.code,
    name: s.name,
    defaultName: s.defaultName,
    isInitial: s.isInitial,
    isTerminal: s.isTerminal,
    isSystem: s.isSystem,
    weight: s.weight,
    color: s.color,
  };
}
