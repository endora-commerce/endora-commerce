import type { EntityManager } from '@mikro-orm/postgresql';
import type { FilterQuery } from '@mikro-orm/core';
import type {
  AdminUserReadPort,
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
import { caseReference, derivedReferencePrefix } from '../domain/case-reference.js';
import { resolveAuthorizers } from './authorizer-names.js';
import { caseLinesOf } from './case-lines.js';
import { summaryExtras } from './return-case-service.js';

export interface ReturnListServiceDeps {
  emFactory: () => EntityManager;
  graphService: ReturnStatusGraphService;
  transitions: ReturnTransitionService;
  /** `admin_users`' reader: the *Authorized by* column, one batched lookup per page (180 FR-A41). */
  adminUsers: Pick<AdminUserReadPort, 'findByIds'>;
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
    const where = await this.buildWhere(query);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const [field, dir] = (query.sort ?? 'submittedAt:desc').split(':') as [string, 'asc' | 'desc'];
    // `id` breaks ties in the key's direction so offset pages never repeat or
    // skip a case sharing the sort key (issue #1760).
    const orderBy = field === 'rmaNumber' ? { rmaNumber: dir, id: dir } : { submittedAt: dir, id: dir };

    const [cases, total] = await em.findAndCount(ReturnCase, where, {
      orderBy,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const graph = await this.deps.graphService.loadGraph();
    const authorizers = await resolveAuthorizers(this.deps.adminUsers, cases);
    // 180 D-3 — the first line's name and the line count, one read for the page.
    const lines = await caseLinesOf(em, cases.map((rc) => rc.id));
    const rows: AdminReturnRow[] = cases.map((rc) => ({
      id: rc.id,
      rmaNumber: rc.rmaNumber ?? null,
      kind: rc.kind,
      orderId: rc.orderId ?? null,
      statusCode: rc.statusCode,
      statusLabel: graph.get(rc.statusCode)?.defaultName ?? rc.statusCode,
      totalRefundAmount: Number(rc.totalRefundAmount),
      currency: rc.currency,
      submittedAt: rc.submittedAt.toISOString(),
      // Inherited from the case summary (`specs/170-organization-roles/`
      // FR-053): the account that filed the case.
      customerAccountId: rc.customerAccountId ?? null,
      reference: caseReference(rc),
      ...summaryExtras(rc, lines.get(rc.id)),
      // `specs/181-guest-complaints/` (admin-api.md A1) — a guest has no account to name,
      // so the column names the contact as given, until the data is erased.
      customerName: rc.customerAccountId == null ? (rc.contact?.name ?? null) : null,
      organizationName: null,
      authorizedBy: authorizers.get(rc.id) ?? null,
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

  async buildWhere(query: AdminReturnsListQuery): Promise<FilterQuery<ReturnCase>> {
    const where: FilterQuery<ReturnCase> = {};
    const statuses = (query.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length > 0) Object.assign(where, { statusCode: { $in: statuses } });
    if (query.kind) Object.assign(where, { kind: query.kind });
    // 180 FR-B34, FR-B35 — off-platform is the missing order, nothing else: a case
    // against an order imported from an ERP is a platform case. 181 (admin-api.md A1)
    // splits it by filer; `off_platform` keeps 180's meaning, both kinds, so a saved view
    // stored before 181 lists what it listed. A guest case is the missing account, and
    // the tenant filter has already kept it from every admin who may not see it (R-1).
    if (query.origin === 'off_platform') Object.assign(where, { orderId: null });
    if (query.origin === 'platform') Object.assign(where, { orderId: { $ne: null } });
    if (query.origin === 'off_platform_customer') Object.assign(where, { orderId: null, customerAccountId: { $ne: null } });
    if (query.origin === 'guest') Object.assign(where, { customerAccountId: null });
    if (query.rmaNumber) Object.assign(where, { rmaNumber: { $ilike: `%${query.rmaNumber}%` } });
    if (query.q) {
      const q = query.q.trim();
      const or: Array<FilterQuery<ReturnCase>> = [{ rmaNumber: { $ilike: `%${q}%` } }];
      // An order id is matched only when the term is one: a uuid column compared
      // with any other text is a database error, not an empty result.
      if (isUuidShape(q)) or.push({ orderId: q });
      // `specs/180-off-platform-complaints/` FR-A44 — the derived reference
      // (`#3F9A21C0` or `3F9A21C0`) is the first eight hex characters of the id.
      const prefix = derivedReferencePrefix(q);
      if (prefix) or.push({ id: { $in: await this.idsStartingWith(prefix) } });
      // `specs/181-guest-complaints/` FR-061, research R-10 — the contact address, matched
      // whole and never in part, so the search cannot enumerate addresses.
      if (isEmailShape(q)) or.push({ id: { $in: await this.idsWithContactEmail(q) } });
      Object.assign(where, { $or: or });
    }
    return where;
  }

  /**
   * The case ids beginning with eight hex characters. The statement is raw, so the
   * tenant filter does not apply to it — the ids it answers go back into the list's
   * own `findAndCount`, which does; nothing here is returned to the caller.
   */
  private async idsStartingWith(prefix: string): Promise<string[]> {
    const rows = await this.deps
      .emFactory()
      .execute<Array<{ id: string }>>(
        `select "id" from "return_cases" where replace("id"::text, '-', '') like ? limit 50`,
        [`${prefix}%`],
      );
    return rows.map((r) => r.id);
  }

  /**
   * The case ids whose contact address is exactly `email`, in any letter case, over the
   * expression index `return_cases_contact_email_idx`. Raw like {@link idsStartingWith},
   * and for the same reason harmless: the ids go back into the filtered list query.
   */
  private async idsWithContactEmail(email: string): Promise<string[]> {
    const rows = await this.deps
      .emFactory()
      .execute<Array<{ id: string }>>(
        `select "id" from "return_cases" where "contact" is not null and lower("contact"->>'email') = lower(?) limit 200`,
        [email],
      );
    return rows.map((r) => r.id);
  }

  private async statusCounts(): Promise<Record<string, number>> {
    const em = this.deps.emFactory();
    // The main list uses em.findAndCount (auto-filtered), but this aggregate is
    // a raw statement, so apply the tenant org constraint explicitly (feature 050).
    const constraint = orgConstraintFor();
    let scope: { sql: string; params: readonly unknown[] } = { sql: 'true', params: [] };
    if (constraint.kind === 'single') {
      // `is null` matches nothing since D-178: the only actor that reached it
      // was a signed-in customer with no Organization, and
      // `customer_accounts.organization_id` is `NOT NULL` now. Kept because the
      // constraint type still admits a null.
      scope =
        constraint.organizationId === null
          ? { sql: '"organization_id" is null', params: [] }
          : { sql: '"organization_id" = ?', params: [constraint.organizationId] };
    } else if (constraint.kind !== 'all') {
      // The platform's predicate for the reach (issue #305): a sales
      // representative's is every organization nobody else governs.
      scope = orgScopeSql('organization_id', constraint);
    }
    const rows = await em.execute<Array<{ status_code: string; count: string }>>(
      `select "status_code", count(*) as "count" from "return_cases" where ${scope.sql} group by "status_code"`,
      [...scope.params],
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status_code] = Number(r.count);
    return out;
  }
}

/** A whole e-mail address, as the search treats one: no spaces, one `@`, a dotted domain. */
function isEmailShape(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
