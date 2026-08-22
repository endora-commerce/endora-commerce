import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import { ReturnStatus } from '../entities/return-status.entity.js';
import { ReturnStatusTransition } from '../entities/return-status-transition.entity.js';
import { ReturnCase } from '../entities/return-case.entity.js';
import {
  RETURN_STATUS_INITIAL,
  ReturnStatusGraph,
  type ReturnStatusDef,
  type ReturnTransitionDef,
} from '../domain/return-status-graph.js';

/**
 * ReturnStatusGraphService — feature 046 (US3).
 *
 * DB-backed loader + admin CRUD for the configurable RMA lifecycle. Builds an
 * immutable `ReturnStatusGraph` from `return_statuses` + `return_status_transitions`
 * and caches it in-process; every mutation invalidates the cache. Mirrors
 * `OrderStatusGraphService`.
 */
export class ReturnStatusGraphService {
  private cached: ReturnStatusGraph | null = null;

  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits status-graph writes co-transactionally when provided. */
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'return_status',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  invalidate(): void {
    this.cached = null;
  }

  /** Build (or return cached) the validated graph. */
  async loadGraph(): Promise<ReturnStatusGraph> {
    if (this.cached) return this.cached;
    const em = this.emFactory();
    const [statuses, transitions] = await Promise.all([
      em.find(ReturnStatus, {}, { orderBy: { weight: 'asc' } }),
      em.find(ReturnStatusTransition, {}),
    ]);
    const graph = new ReturnStatusGraph(
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

  async hasStatus(code: string): Promise<boolean> {
    return (await this.loadGraph()).has(code);
  }

  /** The graph plus per-status `inUseCount` for the admin config view. */
  async listGraph(): Promise<{
    statuses: Array<ReturnStatusDef & { inUseCount: number }>;
    transitions: ReturnTransitionDef[];
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
    const rows = await em
      .getKnex()
      .from('return_cases')
      .select('status_code')
      .count<{ status_code: string; count: string }[]>('* as count')
      .groupBy('status_code');
    return new Map(rows.map((r) => [r.status_code, Number(r.count)]));
  }

  async createStatus(input: {
    code: string;
    name: Record<string, string>;
    defaultName: string;
    isTerminal?: boolean | undefined;
    weight?: number | undefined;
    color?: string | undefined;
  }): Promise<void> {
    const em = this.emFactory();
    const existing = await em.findOne(ReturnStatus, { code: input.code });
    if (existing) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, `Status "${input.code}" already exists.`);
    }
    const status = em.create(ReturnStatus, {
      code: input.code,
      name: input.name,
      defaultName: input.defaultName,
      isInitial: false,
      isTerminal: input.isTerminal ?? false,
      isSystem: false,
      weight: input.weight ?? 100,
      color: input.color ?? '#64748b',
    });
    em.persist(status);
    this.#audit(em, 'return_status.create', input.code, null, { code: input.code, defaultName: input.defaultName });
    await em.flush();
    this.invalidate();
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
    const em = this.emFactory();
    const status = await em.findOne(ReturnStatus, { code });
    if (!status) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Status "${code}" not found.`);
    if (patch.name !== undefined) status.name = patch.name;
    if (patch.defaultName !== undefined) status.defaultName = patch.defaultName;
    if (patch.weight !== undefined) status.weight = patch.weight;
    if (patch.color !== undefined) status.color = patch.color;
    if (patch.isTerminal !== undefined && patch.isTerminal !== status.isTerminal) {
      if (patch.isTerminal) {
        const outgoing = await em.count(ReturnStatusTransition, { fromStatusCode: code });
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
    this.#audit(em, 'return_status.update', code, null, {
      defaultName: status.defaultName,
      weight: status.weight,
      color: status.color,
      isTerminal: status.isTerminal,
    });
    await em.flush();
    this.invalidate();
  }

  async deleteStatus(code: string): Promise<void> {
    const em = this.emFactory();
    const status = await em.findOne(ReturnStatus, { code });
    if (!status) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Status "${code}" not found.`);
    if (code === RETURN_STATUS_INITIAL || status.isInitial) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'The initial status cannot be deleted.');
    }
    const inUse = await em.count(ReturnCase, { statusCode: code });
    if (inUse > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        `Cannot delete status "${code}" while ${inUse} case(s) use it.`,
      );
    }
    const edges = await em.find(ReturnStatusTransition, {
      $or: [{ fromStatusCode: code }, { toStatusCode: code }],
    });
    this.#audit(em, 'return_status.delete', code, { code, defaultName: status.defaultName }, null);
    await em.remove(edges).remove(status).flush();
    this.invalidate();
  }

  /**
   * Replace the full transition set (PUT semantics). Validates every pair
   * against the current statuses and the no-edge-from-terminal invariant, then
   * swaps the persisted rows.
   */
  async replaceTransitions(
    pairs: Array<{ fromStatusCode: string; toStatusCode: string }>,
  ): Promise<void> {
    const em = this.emFactory();
    const graph = await this.loadGraph();
    for (const edge of pairs) {
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
    }
    const existing = await em.find(ReturnStatusTransition, {});
    await em.remove(existing).flush();
    const seen = new Set<string>();
    for (const edge of pairs) {
      const key = `${edge.fromStatusCode} ${edge.toStatusCode}`;
      if (seen.has(key) || edge.fromStatusCode === edge.toStatusCode) continue;
      seen.add(key);
      em.persist(
        em.create(ReturnStatusTransition, {
          fromStatusCode: edge.fromStatusCode,
          toStatusCode: edge.toStatusCode,
          isSystem: false,
        }),
      );
    }
    this.#audit(em, 'return_status.replace_transitions', 'graph', null, { count: seen.size });
    await em.flush();
    this.invalidate();
  }
}

function toStatusDef(s: ReturnStatus): ReturnStatusDef {
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
