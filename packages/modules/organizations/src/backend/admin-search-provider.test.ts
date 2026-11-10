import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdminSearchProviderQuery } from '@endora-commerce/contracts';
import {
  ORGANIZATION_ADMIN_SEARCH_STATUS_KEYS,
  createOrganizationAdminSearchProvider,
  type OrganizationAdminSearchRow,
} from './admin-search-provider.js';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>;

function query(over: Partial<AdminSearchProviderQuery> = {}): AdminSearchProviderQuery {
  return {
    text: 'lodz',
    likeEscaped: 'lodz',
    isUuid: false,
    fields: ['name', 'taxId'],
    limit: 5,
    language: 'pl',
    adminUserId: 'admin-1',
    signal: { aborted: false },
    ...over,
  };
}

const row: OrganizationAdminSearchRow = {
  id: 'org-1',
  name: 'Łódź Meble',
  taxId: '5260250995',
  city: 'Łódź',
  status: 'pending_verification',
};

describe('organizations admin search provider — descriptor', () => {
  const provider = createOrganizationAdminSearchProvider({
    search: async () => ({ rows: [], hasMore: false }),
    translate: async (key) => key,
  });

  it("declares the Organization record type with its list's any-of permission", () => {
    expect(provider).toMatchObject({
      entityType: 'organizations.organization',
      moduleId: 'organizations',
      requiredPermission: ['customers:read', 'customers:manage'],
      weight: 400,
      icon: 'Building2',
      labelKey: 'adminSearch.group.label',
    });
  });

  it('offers name, tax ID and legal name with their defaults and identifiers (FR-022)', () => {
    expect(provider.fields.map((f) => [f.code, f.defaultSelected, f.identifier])).toEqual([
      ['name', true, false],
      ['taxId', true, true],
      ['legalName', false, false],
    ]);
  });

  it.each(['en', 'pl'] as const)('has every label and status key in the %s bundle', (language) => {
    const keys = bundle(language);
    const all = [
      provider.labelKey,
      ...provider.fields.map((f) => f.labelKey),
      ...Object.values(ORGANIZATION_ADMIN_SEARCH_STATUS_KEYS),
    ];
    for (const key of all) expect(keys[key], `${language}: ${key}`).toEqual(expect.any(String));
  });
});

describe('organizations admin search provider — mapping', () => {
  it('maps a row to the organization screen with tax ID, city and a localized status', async () => {
    const search = vi.fn(async () => ({ rows: [row], hasMore: false }));
    const translate = vi.fn(async (key: string, language: string) => `${language}:${key}`);
    const provider = createOrganizationAdminSearchProvider({ search, translate });
    const result = await provider.search(query());
    expect(search).toHaveBeenCalledWith({
      text: 'lodz',
      likeEscaped: 'lodz',
      isUuid: false,
      fields: ['name', 'taxId'],
      limit: 5,
    });
    expect(result.hits).toEqual([
      {
        id: 'org-1',
        title: 'Łódź Meble',
        subtitle: '5260250995 · Łódź',
        status: { code: 'pending_verification', label: 'pl:adminSearch.status.pendingVerification' },
        targetRoute: '/organizations/org-1',
      },
    ]);
  });

  // `specs/177-tax-id-scope/` T015 (O11) — a row without a tax ID shows the city alone.
  it('omits a null tax ID from the subtitle', async () => {
    const provider = createOrganizationAdminSearchProvider({
      search: async () => ({ rows: [{ ...row, taxId: null }, { ...row, id: 'org-2', taxId: null, city: null }], hasMore: false }),
      translate: async (key) => key,
    });
    const result = await provider.search(query());
    expect(result.hits.map((hit) => hit.subtitle)).toEqual(['Łódź', null]);
  });
});
