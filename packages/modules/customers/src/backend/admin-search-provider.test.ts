import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdminSearchProviderQuery, CustomerAccountRecord } from '@endora-commerce/contracts';
import {
  CUSTOMER_ADMIN_SEARCH_STATUS_KEYS,
  createCustomerAdminSearchProvider,
  searchCustomersForAdmin,
  type CustomerAdminSearchRow,
} from './admin-search-provider.js';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>;

function query(over: Partial<AdminSearchProviderQuery> = {}): AdminSearchProviderQuery {
  return {
    text: 'kowalski@',
    likeEscaped: 'kowalski@',
    isUuid: false,
    fields: ['email', 'name'],
    limit: 5,
    language: 'pl',
    adminUserId: 'admin-1',
    signal: { aborted: false },
    ...over,
  };
}

const row: CustomerAdminSearchRow = {
  id: 'c1',
  firstName: 'Jan',
  lastName: 'Kowalski',
  email: 'jan.kowalski@example.com',
  organizationName: 'ACME',
  status: 'blocked',
};

describe('customers admin search provider — descriptor', () => {
  const provider = createCustomerAdminSearchProvider({
    search: async () => ({ rows: [], hasMore: false }),
    translate: async (key) => key,
  });

  it('declares the Customer record type, its permission, weight and icon', () => {
    expect(provider).toMatchObject({
      entityType: 'customers.customer',
      moduleId: 'customers',
      requiredPermission: 'customers:read',
      weight: 500,
      icon: 'Users',
      labelKey: 'adminSearch.group.label',
    });
  });

  it('offers e-mail and name, both by default, e-mail as the identifier (FR-022)', () => {
    expect(provider.fields.map((f) => [f.code, f.defaultSelected, f.identifier])).toEqual([
      ['email', true, true],
      ['name', true, false],
    ]);
  });

  it.each(['en', 'pl'] as const)('has every label and status key in the %s bundle', (language) => {
    const keys = bundle(language);
    const all = [
      provider.labelKey,
      ...provider.fields.map((f) => f.labelKey),
      ...Object.values(CUSTOMER_ADMIN_SEARCH_STATUS_KEYS),
    ];
    for (const key of all) expect(keys[key], `${language}: ${key}`).toEqual(expect.any(String));
  });

  it('maps a row to the customer screen', async () => {
    const translate = vi.fn(async (key: string, language: string) => `${language}:${key}`);
    const provider2 = createCustomerAdminSearchProvider({ search: async () => ({ rows: [row], hasMore: false }), translate });
    const { hits } = await provider2.search(query());
    expect(hits).toEqual([
      {
        id: 'c1',
        title: 'Jan Kowalski',
        subtitle: 'jan.kowalski@example.com · ACME',
        status: { code: 'blocked', label: 'pl:adminSearch.status.blocked' },
        targetRoute: '/customers/c1',
      },
    ]);
  });
});

function record(over: Partial<CustomerAccountRecord>): CustomerAccountRecord {
  return {
    id: 'c1',
    organizationId: 'org-a',
    email: 'a@example.com',
    firstName: 'A',
    lastName: 'B',
    deletedAt: null,
    anonymizedAt: null,
    blockedAt: null,
    ...over,
  } as CustomerAccountRecord;
}

describe('searchCustomersForAdmin', () => {
  it("passes the list's scope, the selected fields and excludeDeleted to the owner's search", async () => {
    const search = vi.fn(async () => ({ rows: [record({})], total: 1 }));
    const result = await searchCustomersForAdmin(
      {
        accountSearch: { search },
        accounts: { findById: async () => null },
        organizations: { findByIds: async () => [{ id: 'org-a', name: 'ACME' }] as never },
      },
      { text: 'a@', likeEscaped: 'a@', isUuid: false, fields: ['email'], limit: 5 },
      { isPlatformAdmin: false, reach: { kind: 'allowed', organizationIds: ['org-a'] } },
    );
    // Issue #305 — the owner's read is narrowed by the tenant filter, which is
    // the reach rule; no list of ids is passed beside it.
    expect(search).toHaveBeenCalledWith({
      q: 'a@',
      qFields: ['email'],
      excludeDeleted: true,
      allowedOrganizationIds: null,
      page: 1,
      pageSize: 6,
    });
    expect(result.rows[0]).toMatchObject({ id: 'c1', organizationName: 'ACME', status: 'active' });
  });

  it('finds an account by id only inside the scope and only when not deleted or anonymized', async () => {
    const deps = (found: CustomerAccountRecord | null) => ({
      accountSearch: { search: async () => ({ rows: [], total: 0 }) },
      accounts: { findById: async () => found },
      organizations: { findByIds: async () => [] },
    });
    const uuid = '0b8f6a3e-6a1f-4c1e-9d5b-1e2f3a4b5c6d';
    const q = { text: uuid, likeEscaped: uuid, isUuid: true, fields: ['name'], limit: 5 };
    const inScope = { isPlatformAdmin: false, reach: { kind: 'allowed', organizationIds: ['org-a'] } } as const;
    expect((await searchCustomersForAdmin(deps(record({ id: uuid })), q, inScope)).rows).toHaveLength(1);
    expect(
      (await searchCustomersForAdmin(deps(record({ id: uuid, organizationId: 'org-b' })), q, inScope)).rows,
    ).toHaveLength(0);
    expect(
      (await searchCustomersForAdmin(deps(record({ id: uuid, anonymizedAt: new Date() })), q, inScope)).rows,
    ).toHaveLength(0);
    expect(
      (
        await searchCustomersForAdmin(deps(record({ id: uuid, organizationId: 'org-b' })), q, {
          isPlatformAdmin: true,
        })
      ).rows,
    ).toHaveLength(1);
    // Issue #305 — a sales representative: every organization nobody else governs.
    const rep = {
      isPlatformAdmin: false,
      reach: { kind: 'excluded', excludedOrganizationIds: ['org-b'], assignedOrganizationIds: [], excludedOrganizationsQuery: { sql: 'select x from "reach"(?::uuid) as x', params: ['rep'] } },
    } as const;
    expect((await searchCustomersForAdmin(deps(record({ id: uuid, organizationId: 'org-u' })), q, rep)).rows).toHaveLength(1);
    expect((await searchCustomersForAdmin(deps(record({ id: uuid, organizationId: 'org-b' })), q, rep)).rows).toHaveLength(0);
  });
});
