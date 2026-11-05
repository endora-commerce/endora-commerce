import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdminSearchProviderQuery } from '@endora-commerce/contracts';
import {
  PRODUCT_ADMIN_SEARCH_STATUS_KEYS,
  createCategoryAdminSearchProvider,
  createProductAdminSearchProvider,
  pickLocalizedName,
} from './admin-search-provider.js';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>;

function query(over: Partial<AdminSearchProviderQuery> = {}): AdminSearchProviderQuery {
  return {
    text: 'chair',
    likeEscaped: 'chair',
    isUuid: false,
    fields: ['sku', 'name'],
    limit: 5,
    language: 'pl',
    adminUserId: 'admin-1',
    signal: { aborted: false },
    ...over,
  };
}

describe('catalog admin search providers — descriptors', () => {
  const product = createProductAdminSearchProvider({
    search: async () => ({ rows: [], hasMore: false }),
    translate: async (key) => key,
  });
  const category = createCategoryAdminSearchProvider({ search: async () => ({ rows: [], hasMore: false }) });

  it('declares the Product record type (FR-022)', () => {
    expect(product).toMatchObject({
      entityType: 'catalog.product',
      moduleId: 'catalog',
      requiredPermission: 'catalog:read',
      weight: 600,
      icon: 'Package',
      labelKey: 'adminSearch.product.group.label',
    });
    expect(product.fields.map((f) => [f.code, f.defaultSelected, f.identifier])).toEqual([
      ['sku', true, true],
      ['name', true, false],
      ['slug', false, true],
      ['quickSearchAttributes', false, false],
    ]);
  });

  it('declares the Category record type (FR-022)', () => {
    expect(category).toMatchObject({
      entityType: 'catalog.category',
      moduleId: 'catalog',
      requiredPermission: 'catalog:read',
      weight: 700,
      icon: 'Layers',
      labelKey: 'adminSearch.category.group.label',
    });
    expect(category.fields.map((f) => [f.code, f.defaultSelected, f.identifier])).toEqual([
      ['name', true, false],
      ['slug', true, true],
    ]);
  });

  it.each(['en', 'pl'] as const)('has every label and status key in the %s bundle', (language) => {
    const keys = bundle(language);
    const all = [
      product.labelKey,
      ...product.fields.map((f) => f.labelKey),
      category.labelKey,
      ...category.fields.map((f) => f.labelKey),
      ...Object.values(PRODUCT_ADMIN_SEARCH_STATUS_KEYS),
    ];
    for (const key of all) expect(keys[key], `${language}: ${key}`).toEqual(expect.any(String));
  });
});

describe('pickLocalizedName', () => {
  it('prefers the admin language, then English, then any name', () => {
    expect(pickLocalizedName({ 'en-US': 'Chair', 'pl-PL': 'Krzesło' }, 'pl')).toBe('Krzesło');
    expect(pickLocalizedName({ pl: 'Krzesło', en: 'Chair' }, 'pl')).toBe('Krzesło');
    expect(pickLocalizedName({ 'en-US': 'Chair', 'de-DE': 'Stuhl' }, 'pl')).toBe('Chair');
    expect(pickLocalizedName({ 'de-DE': 'Stuhl' }, 'pl')).toBe('Stuhl');
    expect(pickLocalizedName({ 'pl-PL': '' , 'en-US': 'Chair' }, 'pl')).toBe('Chair');
    expect(pickLocalizedName({}, 'pl')).toBeNull();
  });
});

describe('catalog admin search providers — mapping', () => {
  it('maps a product to its screen, named by its Global name (174, FR-031), with SKU, type and status', async () => {
    const translate = vi.fn(async (key: string, language: string) => `${language}:${key}`);
    const search = vi.fn(async () => ({
      rows: [{ id: 'p1', sku: 'CHAIR-RED', name: 'Czerwone krzesło', type: 'simple', status: 'inactive' }],
      hasMore: false,
    }));
    const provider = createProductAdminSearchProvider({ search, translate });
    const { hits } = await provider.search(query());
    expect(search).toHaveBeenCalledWith({ text: 'chair', likeEscaped: 'chair', isUuid: false, fields: ['sku', 'name'], limit: 5 });
    expect(hits).toEqual([
      {
        id: 'p1',
        title: 'Czerwone krzesło',
        subtitle: 'CHAIR-RED · simple',
        status: { code: 'inactive', label: 'pl:adminSearch.product.status.inactive' },
        targetRoute: '/catalog/products/p1',
      },
    ]);
  });

  it('maps a category to the tree focused on it, with its parent path', async () => {
    const provider = createCategoryAdminSearchProvider({
      search: async () => ({
        rows: [
          {
            id: 'c1',
            name: { 'en-US': 'Chairs', 'pl-PL': 'Krzesła' },
            path: [{ 'en-US': 'Furniture', 'pl-PL': 'Meble' }, { 'en-US': 'Seating' }],
          },
        ],
        hasMore: true,
      }),
    });
    const result = await provider.search(query({ fields: ['name'] }));
    expect(result).toEqual({
      hasMore: true,
      hits: [
        {
          id: 'c1',
          title: 'Krzesła',
          subtitle: 'Meble › Seating',
          status: null,
          targetRoute: '/catalog/categories?focus=c1',
        },
      ],
    });
  });
});

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-045, research
 * R-15) — the admin product search matches SKU, name, slug and quick-search
 * attribute values, and never a product's Page Builder content: the content
 * lives in its own table, which the search's query does not read, and a
 * content attribute cannot be quick-searchable (research R-6).
 */
describe('admin product search — no Page Builder content (feature 172)', () => {
  it('offers no content field, and its query reads no content table', () => {
    const product = createProductAdminSearchProvider({
      search: async () => ({ rows: [], hasMore: false }),
      translate: async (key) => key,
    });
    expect(product.fields.map((f) => f.code)).not.toContain('content');
    const source = readFileSync(new URL('./services/catalog-admin-search.service.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/product_content_values|ProductContentValue|page_builder/);
    // Quick-search attributes are chosen by the flag a content attribute cannot carry.
    expect(source).toMatch(/listByFlag\('quickSearchable'\)/);
  });
});
