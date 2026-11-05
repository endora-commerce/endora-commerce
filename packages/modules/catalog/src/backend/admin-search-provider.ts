import type {
  AdminSearchFieldDescriptor,
  AdminSearchProvider,
  AdminSearchProviderQuery,
  SupportedAdminLanguage,
} from '@endora-commerce/contracts';

/** What the Product record type offers global search (`specs/150-admin-global-search/` FR-022). */
export const PRODUCT_ADMIN_SEARCH_FIELDS: readonly AdminSearchFieldDescriptor[] = [
  { code: 'sku', labelKey: 'adminSearch.product.field.sku', defaultSelected: true, identifier: true },
  { code: 'name', labelKey: 'adminSearch.product.field.name', defaultSelected: true, identifier: false },
  { code: 'slug', labelKey: 'adminSearch.product.field.slug', defaultSelected: false, identifier: true },
  {
    code: 'quickSearchAttributes',
    labelKey: 'adminSearch.product.field.quickSearchAttributes',
    defaultSelected: false,
    identifier: false,
  },
];

/** What the Category record type offers global search (FR-022). */
export const CATEGORY_ADMIN_SEARCH_FIELDS: readonly AdminSearchFieldDescriptor[] = [
  { code: 'name', labelKey: 'adminSearch.category.field.name', defaultSelected: true, identifier: false },
  { code: 'slug', labelKey: 'adminSearch.category.field.slug', defaultSelected: true, identifier: true },
];

export const PRODUCT_ADMIN_SEARCH_STATUS_KEYS: Readonly<Record<string, string>> = {
  active: 'adminSearch.product.status.active',
  inactive: 'adminSearch.product.status.inactive',
};

export interface CatalogAdminSearchQuery {
  readonly text: string;
  readonly likeEscaped: string;
  readonly isUuid: boolean;
  readonly fields: readonly string[];
  readonly limit: number;
}

export interface ProductAdminSearchRow {
  readonly id: string;
  readonly sku: string;
  /** Feature 174 (FR-031) — the Global name, shown whatever the admin's language. */
  readonly name: string;
  readonly type: string;
  readonly status: string;
}

export interface CategoryAdminSearchRow {
  readonly id: string;
  readonly name: Record<string, string>;
  /** The ancestors' names, root first. */
  readonly path: readonly Record<string, string>[];
}

/**
 * A per-language name for an admin: the admin's language (an exact key or a
 * regional one, `pl-PL` for `pl`), then English, then whatever name exists.
 */
export function pickLocalizedName(name: Record<string, string>, language: SupportedAdminLanguage): string | null {
  const entries = Object.entries(name).filter(([, value]) => typeof value === 'string' && value !== '');
  const forLanguage = (lang: string) =>
    entries.find(([key]) => key.toLowerCase() === lang) ??
    entries.find(([key]) => key.toLowerCase().split(/[-_]/)[0] === lang);
  return (forLanguage(language) ?? forLanguage('en') ?? entries[0])?.[1] ?? null;
}

export interface ProductAdminSearchProviderDeps {
  search(query: CatalogAdminSearchQuery): Promise<{ rows: ProductAdminSearchRow[]; hasMore: boolean }>;
  translate(key: string, language: SupportedAdminLanguage): Promise<string>;
}

export interface CategoryAdminSearchProviderDeps {
  search(query: CatalogAdminSearchQuery): Promise<{ rows: CategoryAdminSearchRow[]; hasMore: boolean }>;
}

function forward(query: AdminSearchProviderQuery): CatalogAdminSearchQuery {
  return {
    text: query.text,
    likeEscaped: query.likeEscaped,
    isUuid: query.isUuid,
    fields: query.fields,
    limit: query.limit,
  };
}

/**
 * The Product provider. Visibility is the product list's: `catalog:read`, and
 * every product that is not deleted — inactive and archived ones included, with
 * their status (FR-016).
 */
export function createProductAdminSearchProvider(deps: ProductAdminSearchProviderDeps): AdminSearchProvider {
  return {
    entityType: 'catalog.product',
    moduleId: 'catalog',
    labelKey: 'adminSearch.product.group.label',
    icon: 'Package',
    requiredPermission: 'catalog:read',
    weight: 600,
    fields: PRODUCT_ADMIN_SEARCH_FIELDS,
    async search(query) {
      const { rows, hasMore } = await deps.search(forward(query));
      const hits = await Promise.all(
        rows.map(async (row) => {
          const statusKey = PRODUCT_ADMIN_SEARCH_STATUS_KEYS[row.status];
          return {
            id: row.id,
            title: row.name !== '' ? row.name : row.sku,
            subtitle: `${row.sku} · ${row.type}`,
            status: {
              code: row.status,
              label: statusKey === undefined ? row.status : await deps.translate(statusKey, query.language),
            },
            targetRoute: `/catalog/products/${row.id}`,
          };
        }),
      );
      return { hits, hasMore };
    },
  };
}

/**
 * The Category provider. Categories have no detail screen — the tree is the
 * editor — so a result opens the tree focused on it (research R-15).
 */
export function createCategoryAdminSearchProvider(deps: CategoryAdminSearchProviderDeps): AdminSearchProvider {
  return {
    entityType: 'catalog.category',
    moduleId: 'catalog',
    labelKey: 'adminSearch.category.group.label',
    icon: 'Layers',
    requiredPermission: 'catalog:read',
    weight: 700,
    fields: CATEGORY_ADMIN_SEARCH_FIELDS,
    async search(query) {
      const { rows, hasMore } = await deps.search(forward(query));
      return {
        hasMore,
        hits: rows.map((row) => {
          const path = row.path
            .map((ancestor) => pickLocalizedName(ancestor, query.language))
            .filter((part): part is string => part !== null)
            .join(' › ');
          return {
            id: row.id,
            title: pickLocalizedName(row.name, query.language) ?? row.id,
            subtitle: path === '' ? null : path,
            status: null,
            targetRoute: `/catalog/categories?focus=${row.id}`,
          };
        }),
      };
    },
  };
}
