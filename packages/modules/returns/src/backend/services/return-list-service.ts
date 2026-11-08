import type { EntityManager, Knex } from '@mikro-orm/postgresql';
import type { FilterQuery } from '@mikro-orm/core';
import type {
  AdminReturnRow,
  AdminReturnsListQuery,
  AdminReturnsListResponse,
  BulkTransitionResult,
} from '@endora-commerce/contracts';
import { ReturnCase } from '../entities/return-case.entity.js';
import { orgConstraintFor, orgScopeSql } from '@endora-commerce/platform/tenancy';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import { isUuidShape } from '@endora-commerce/contracts';

export interface ReturnListServiceDeps {
  emFactory: () => EntityManager;
  graphService: ReturnStatusGraphService;
  transitions: ReturnTransitionService;
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * ReturnListService — feature 046 (US8).
 *
 * Filter/search/sort the admin returns list with per-status counts, plus a
 * bulk status change that skips cases whose current status does not permit the
 * target transition. Mirrors `OrderListService`.
 */
export class ReturnListService {
  constructor(private readonly deps: ReturnListServiceDeps) {}

  async list(query: AdminReturnsListQuery): Promise<AdminReturnsListResponse> {
    const em = this.deps.emFactory();
    const where = this.buildWhere(query);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const [field, dir] = (query.sort ?? 'submittedAt:desc').split(':') as [string, 'asc' | 'desc'];
    const orderBy = field === 'rmaNumber' ? { rmaNumber: dir } : { submittedAt: dir };

    const [cases, total] = await em.findAndCount(ReturnCase, where, {
      orderBy,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const graph = await this.deps.graphService.loadGraph();
    const rows: AdminReturnRow[] = cases.map((rc) => ({
      id: rc.id,
      rmaNumber: rc.rmaNumber ?? null,
      kind: rc.kind,
      orderId: rc.orderId,
      statusCode: rc.statusCode,
      statusLabel: graph.get(rc.statusCode)?.defaultName ?? rc.statusCode,
      totalRefundAmount: Number(rc.totalRefundAmount),
      currency: rc.currency,
      submittedAt: rc.submittedAt.toISOString(),
      // Inherited from the case summary (`specs/170-organization-roles/`
      // FR-053): the account that filed the case.
      customerAccountId: rc.customerAccountId,
      customerName: null,
      organizationName: null,
    }));

    return { rows, total, counts: await this.statusCounts() };
  }

  async bulkTransition(
    ids: string[],
    to: string,
    adminUserId: string,
    reason?: string,
  ): Promise<BulkTransitionResult> {
    const em = this.deps.emFactory();
    const graph = await this.deps.graphService.loadGraph();
    const moved: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      if (!isUuidShape(id)) {
        skipped.push({ id, reason: 'not_found' });
        continue;
      }
      const rc = await em.findOne(ReturnCase, { id });
      if (!rc) {
        skipped.push({ id, reason: 'not_found' });
        continue;
      }
      if (!graph.canTransition(rc.statusCode, to)) {
        skipped.push({ id, reason: `cannot transition from "${rc.statusCode}"` });
        continue;
      }
      await this.deps.transitions.apply(
        id,
        to,
        { kind: 'admin', adminUserId },
        reason !== undefined ? { reason } : undefined,
      );
      moved.push(id);
    }
    return { moved, skipped };
  }

  buildWhere(query: AdminReturnsListQuery): FilterQuery<ReturnCase> {
    const where: FilterQuery<ReturnCase> = {};
    const statuses = (query.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length > 0) Object.assign(where, { statusCode: { $in: statuses } });
    if (query.kind) Object.assign(where, { kind: query.kind });
    if (query.rmaNumber) Object.assign(where, { rmaNumber: { $ilike: `%${query.rmaNumber}%` } });
    if (query.q) {
      Object.assign(where, {
        $or: [{ rmaNumber: { $ilike: `%${query.q}%` } }, { orderId: query.q }],
      });
    }
    return where;
  }

  private async statusCounts(): Promise<Record<string, number>> {
    const em = this.deps.emFactory();
    // The main list uses em.findAndCount (auto-filtered), but this aggregate is
    // raw knex, so apply the tenant org constraint explicitly (feature 050).
    const qb = em
      .getKnex()
      .from('return_cases')
      .select('status_code')
      .count<{ status_code: string; count: string }[]>('* as count')
      .groupBy('status_code');
    const constraint = orgConstraintFor();
    if (constraint.kind === 'single') {
      // `whereNull` matches nothing since D-178: the only actor that reached it
      // was a signed-in customer with no Organization, and
      // `customer_accounts.organization_id` is `NOT NULL` now. Kept because the
      // constraint type still admits a null.
      if (constraint.organizationId === null) void qb.whereNull('organization_id');
      else void qb.where('organization_id', constraint.organizationId);
    } else if (constraint.kind !== 'all') {
      // The platform's predicate for the reach (issue #305): a sales
      // representative's is every organization nobody else governs.
      const reach = orgScopeSql('organization_id', constraint);
      void qb.whereRaw(reach.sql, [...reach.params] as Knex.RawBinding[]);
    }
    const rows = await qb;
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status_code] = Number(r.count);
    return out;
  }
}
