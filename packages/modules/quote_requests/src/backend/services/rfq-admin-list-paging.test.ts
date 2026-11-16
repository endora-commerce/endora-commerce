import { describe, expect, it, vi } from 'vitest';
import { RfqAdminService, type AdminContext } from './rfq-admin-service.js';

/**
 * Issue #317 — the admin list reads one page, in the order asked, and every
 * filter is a condition of that one statement: the scopes resolve their
 * organizations once, never one port call per request read.
 */
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REP: AdminContext = { adminUserId: id(900), isPlatformAdmin: false, roleLabel: 'Sales representative' };
const ORG_A = id(1);
const ORG_B = id(2);

function request(n: number, organizationId: string) {
  return {
    id: id(100 + n),
    businessId: `Q-${n}`,
    organizationId,
    customerAccountId: id(200 + n),
    salesChannelId: null,
    status: 'Pending',
    awaitingCustomerRevisionAcceptance: false,
    submittedAt: null,
    expiresAt: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-02T00:00:00Z'),
    version: 1,
  };
}

function rig(page: ReturnType<typeof request>[] = [request(1, ORG_A)], total = 1) {
  const findAndCount = vi.fn(async () => [page, total] as const);
  const find = vi.fn(async () => []);
  const salesRepAssignment = {
    canSeeOrganization: vi.fn(async () => true),
    listAssignedOrganizationIds: vi.fn(async () => [ORG_A]),
    listForOrganization: vi.fn(async () => []),
    listOrganizationIdsWithAssignments: vi.fn(async () => [ORG_B]),
  };
  const organizations = {
    findByIds: vi.fn(async () => [{ id: ORG_A, name: 'Acme' }]),
    searchIdsByName: vi.fn(async () => [ORG_B]),
  };
  const customerAccounts = {
    findByIds: vi.fn(async () => []),
    searchIdsByName: vi.fn(async () => [id(299)]),
  };
  const taxRateForOrganization = vi.fn(async () => 0.23);
  const service = new RfqAdminService({
    emFactory: () => ({ findAndCount, find }),
    salesRepAssignment,
    organizations,
    customerAccounts,
    rfqService: { taxRateForOrganization },
  } as never);
  return { service, findAndCount, find, salesRepAssignment, organizations, customerAccounts, taxRateForOrganization };
}

type Call = [unknown, Record<string, unknown>, { limit: number; offset: number; orderBy: unknown[] }];
const listCall = (spy: ReturnType<typeof vi.fn>): Call => spy.mock.calls[0] as unknown as Call;

describe('RfqAdminService.listAll — one page, filtered in the query (issue #317)', () => {
  it('reads the page asked for and reports the total the filters match', async () => {
    const { service, findAndCount } = rig([request(1, ORG_A)], 61);
    const result = await service.listAll(REP, { page: 3, pageSize: 25 });
    expect(result.total).toBe(61);
    expect(result.rows.map((r) => r.id)).toEqual([id(101)]);
    expect(findAndCount).toHaveBeenCalledTimes(1);
    const [, , options] = listCall(findAndCount);
    expect(options.limit).toBe(25);
    expect(options.offset).toBe(50);
    // Newest change first, and the id breaks ties so a page boundary is stable.
    expect(options.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'asc' }]);
  });

  it('defaults to the first page of 25', async () => {
    const { service, findAndCount } = rig();
    await service.listAll(REP);
    const [, , options] = listCall(findAndCount);
    expect([options.limit, options.offset]).toEqual([25, 0]);
  });

  it('"mine" is one assignment read and an organization condition of the query', async () => {
    const { service, findAndCount, salesRepAssignment } = rig();
    await service.listAll(REP, { scope: 'mine' });
    expect(salesRepAssignment.listAssignedOrganizationIds).toHaveBeenCalledTimes(1);
    expect(salesRepAssignment.listAssignedOrganizationIds).toHaveBeenCalledWith(REP.adminUserId);
    expect(salesRepAssignment.canSeeOrganization).not.toHaveBeenCalled();
    expect(salesRepAssignment.listForOrganization).not.toHaveBeenCalled();
    const [, where] = listCall(findAndCount);
    expect(where['$and']).toContainEqual({ organizationId: { $in: [ORG_A] } });
  });

  it('"mine" with nothing assigned reads nothing', async () => {
    const { service, findAndCount, salesRepAssignment } = rig();
    salesRepAssignment.listAssignedOrganizationIds.mockResolvedValueOnce([]);
    expect(await service.listAll(REP, { scope: 'mine' })).toEqual({ rows: [], total: 0 });
    expect(findAndCount).not.toHaveBeenCalled();
  });

  it('"unassigned" is one read of the assigned organizations, excluded in the query', async () => {
    const pageOfMany = Array.from({ length: 10 }, (_, n) => request(n, n % 2 === 0 ? ORG_A : id(50 + n)));
    const { service, findAndCount, salesRepAssignment } = rig(pageOfMany, 10);
    await service.listAll(REP, { scope: 'unassigned' });
    expect(salesRepAssignment.listOrganizationIdsWithAssignments).toHaveBeenCalledTimes(1);
    expect(salesRepAssignment.listForOrganization).not.toHaveBeenCalled();
    expect(salesRepAssignment.canSeeOrganization).not.toHaveBeenCalled();
    const [, where] = listCall(findAndCount);
    expect(where['$and']).toContainEqual({ organizationId: { $nin: [ORG_B] } });
  });

  it('"unassigned" with no assignment anywhere adds no condition', async () => {
    const { service, findAndCount, salesRepAssignment } = rig();
    salesRepAssignment.listOrganizationIdsWithAssignments.mockResolvedValueOnce([]);
    await service.listAll(REP, { scope: 'unassigned' });
    const [, where] = listCall(findAndCount);
    expect(where['$and']).toBeUndefined();
  });

  it('applies status, organization and search in the query', async () => {
    const { service, findAndCount, organizations, customerAccounts } = rig();
    await service.listAll(REP, { status: ['Pending', 'Approved'], organizationId: ORG_A, q: 'ac_me' });
    expect(organizations.searchIdsByName).toHaveBeenCalledTimes(1);
    expect(organizations.searchIdsByName).toHaveBeenCalledWith('ac_me');
    expect(customerAccounts.searchIdsByName).toHaveBeenCalledWith('ac_me');
    const [, where] = listCall(findAndCount);
    expect(where['status']).toEqual({ $in: ['Pending', 'Approved'] });
    expect(where['organizationId']).toBe(ORG_A);
    const search = (where['$and'] as Array<{ $or?: Array<Record<string, unknown>> }>).find((c) => c.$or)!;
    // The business id as a literal fragment: `_` is not a wildcard.
    expect(search.$or).toContainEqual({ businessId: { $ilike: '%ac\\_me%' } });
    expect(search.$or).toContainEqual({ organizationId: { $in: [ORG_B] } });
    expect(search.$or).toContainEqual({ customerAccountId: { $in: [id(299)] } });
    // Not a whole id, so no id condition: a uuid fragment would match nearly every row.
    expect(search.$or!.some((condition) => 'id' in condition)).toBe(false);
  });

  it('matches a whole request id exactly', async () => {
    const { service, findAndCount } = rig();
    await service.listAll(REP, { q: id(101) });
    const [, where] = listCall(findAndCount);
    const search = (where['$and'] as Array<{ $or?: Array<Record<string, unknown>> }>).find((c) => c.$or)!;
    expect(search.$or).toContainEqual({ id: id(101) });
  });

  it('sorts by the amount in the query, ascending or descending', async () => {
    const { service, findAndCount } = rig();
    await service.listAll(REP, { sort: 'total:asc' });
    const [, , options] = listCall(findAndCount);
    const [primary, tieBreak] = options.orderBy as [Record<string, unknown>, unknown];
    const [key] = Object.keys(primary);
    expect(String(key)).not.toBe('total');
    expect(Object.values(primary)).toEqual(['asc']);
    expect(tieBreak).toEqual({ id: 'asc' });
  });

  it('enriches only the page it read: one tax-rate read per organization on it', async () => {
    const { service, taxRateForOrganization, organizations } = rig(
      [request(1, ORG_A), request(2, ORG_A), request(3, ORG_B)],
      3_000,
    );
    await service.listAll(REP, { pageSize: 3 });
    expect(taxRateForOrganization).toHaveBeenCalledTimes(2);
    expect(organizations.findByIds).toHaveBeenCalledTimes(1);
  });
});
