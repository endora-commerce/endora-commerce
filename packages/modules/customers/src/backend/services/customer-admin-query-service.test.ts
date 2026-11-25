import { describe, expect, it, vi } from 'vitest';
import {
  isCustomFieldFilterUnavailableFailure,
  type CustomerAccountAdminSearchCriteria,
  type CustomFieldListFilterPort,
} from '@endora-commerce/contracts';
import { CustomerAdminQueryService, type CustomerAdminQueryPorts } from './customer-admin-query-service.js';
import type { CustomerDefaultsService } from './customer-defaults-service.js';

/**
 * Issue #1903 — the admin Customers list takes the custom-field filters of
 * `custom_fields`' list-filter port: the condition it builds goes to
 * `customer_accounts`' search, which intersects it with its own tenant-scoped
 * statement. The reach decision is not made here and is not changed by it.
 */
function service(customFieldListFilter?: Pick<CustomFieldListFilterPort, 'condition' | 'listFilterable'>) {
  const search = vi.fn(async (_criteria: CustomerAccountAdminSearchCriteria) => ({ rows: [], total: 0 }));
  const ports = {
    accounts: {},
    accountSearch: { search },
    organizations: { findByIds: vi.fn(async () => []) },
    customerGroups: { findByIds: vi.fn(async () => []) },
    orders: {},
    ...(customFieldListFilter ? { customFieldListFilter } : {}),
  } as unknown as CustomerAdminQueryPorts;
  return { query: new CustomerAdminQueryService({} as CustomerDefaultsService, ports), search };
}

/** Opaque here: the port builds it and `customer_accounts` runs it; this service only hands it on. */
const CONDITION = { sql: '<the port’s id sub-select>', params: ['tier', 'gold'] };

describe('CustomerAdminQueryService — custom-field filters (#1903)', () => {
  it('hands the port’s condition for `customer` to the search, beside the unchanged scope', async () => {
    const condition = vi.fn(async () => CONDITION);
    const { query, search } = service({ condition, listFilterable: vi.fn() });
    await query.list(
      { customFieldFilters: { tier: { in: ['gold'] } }, page: 2, pageSize: 10 },
      { isPlatformAdmin: false },
    );
    expect(condition).toHaveBeenCalledWith('customer', { tier: { in: ['gold'] } });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ customFieldCondition: CONDITION, allowedOrganizationIds: null, page: 2, pageSize: 10 }),
    );
  });

  it('asks the port nothing and narrows nothing without filters', async () => {
    const condition = vi.fn();
    const { query, search } = service({ condition, listFilterable: vi.fn() });
    await query.list({ page: 1, pageSize: 20 }, { isPlatformAdmin: true });
    await query.list({ customFieldFilters: {}, page: 1, pageSize: 20 }, { isPlatformAdmin: true });
    expect(condition).not.toHaveBeenCalled();
    for (const [criteria] of search.mock.calls) expect(criteria.customFieldCondition ?? null).toBeNull();
  });

  it('refuses filters, naming them, when no port is wired', async () => {
    const { query, search } = service();
    const failure = await query
      .list({ customFieldFilters: { tier: { in: ['gold'] } }, page: 1, pageSize: 20 }, { isPlatformAdmin: true })
      .catch((error: unknown) => error);
    expect(isCustomFieldFilterUnavailableFailure(failure)).toBe(true);
    expect((failure as { keys: string[] }).keys).toEqual(['tier']);
    expect(search).not.toHaveBeenCalled();
  });

  it('offers the port’s list-filter fields for `customer`, and none without the port', async () => {
    const fields = [{ key: 'tier', valueType: 'select' as const, label: {}, labelDefault: 'Tier', options: [] }];
    const listFilterable = vi.fn(async () => fields);
    expect(await service({ condition: vi.fn(), listFilterable }).query.customFieldFilterFields()).toEqual(fields);
    expect(listFilterable).toHaveBeenCalledWith('customer');
    expect(await service().query.customFieldFilterFields()).toEqual([]);
  });
});
