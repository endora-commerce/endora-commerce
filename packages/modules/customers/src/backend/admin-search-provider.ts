import { orgInScope, type OrgConstraint } from '@endora-commerce/platform/tenancy';
import type {
  AdminSearchFieldDescriptor,
  AdminSearchProvider,
  AdminSearchProviderQuery,
  CustomerAccountAdminSearchPort,
  CustomerAccountReadPort,
  CustomerAccountRecord,
  OrganizationDetailsPort,
  SupportedAdminLanguage,
} from '@endora-commerce/contracts';

/** What the Customer record type offers global search (`specs/150-admin-global-search/` FR-022). */
export const CUSTOMER_ADMIN_SEARCH_FIELDS: readonly AdminSearchFieldDescriptor[] = [
  { code: 'email', labelKey: 'adminSearch.field.email', defaultSelected: true, identifier: true },
  { code: 'name', labelKey: 'adminSearch.field.name', defaultSelected: true, identifier: false },
];

export const CUSTOMER_ADMIN_SEARCH_STATUS_KEYS: Readonly<Record<string, string>> = {
  active: 'adminSearch.status.active',
  blocked: 'adminSearch.status.blocked',
};

export interface CustomerAdminSearchQuery {
  readonly text: string;
  readonly likeEscaped: string;
  readonly isUuid: boolean;
  readonly fields: readonly string[];
  readonly limit: number;
}

export interface CustomerAdminSearchRow {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly organizationName: string | null;
  readonly status: 'active' | 'blocked';
}

/**
 * The customer list's scope, as `resolveModerationActor` answers it for the
 * list route. What a scoped admin reaches is the tenant context's (issue #305:
 * a sales representative reaches every organization nobody else governs);
 * `reach` names a constraint explicitly, and defaults to the ambient one.
 */
export interface CustomerAdminSearchScope {
  readonly isPlatformAdmin: boolean;
  readonly reach?: OrgConstraint;
}

export interface CustomerAdminSearchDeps {
  readonly accountSearch: Pick<CustomerAccountAdminSearchPort, 'search'>;
  readonly accounts: Pick<CustomerAccountReadPort, 'findById'>;
  readonly organizations: Pick<OrganizationDetailsPort, 'findByIds'>;
}

/**
 * Global search over customer accounts (`specs/150-admin-global-search/`,
 * T045), through `customer_accounts`' admin search port — the read behind the
 * Customers list — with the list's own scope (the tenant filter on
 * `CustomerAccount`, which for a sales representative is the reach rule), the
 * selected fields (`qFields`, matched literally, e-mail first by relevance)
 * and deleted and anonymized accounts left out (FR-016).
 *
 * The identifier match (FR-010) is the owner's `findById`, held to the same
 * three rules before it is shown.
 */
export async function searchCustomersForAdmin(
  deps: CustomerAdminSearchDeps,
  query: CustomerAdminSearchQuery,
  scope: CustomerAdminSearchScope,
): Promise<{ rows: CustomerAdminSearchRow[]; hasMore: boolean }> {
  const qFields = query.fields.filter((f): f is 'email' | 'name' => f === 'email' || f === 'name');
  const [byText, byId] = await Promise.all([
    deps.accountSearch.search({
      q: query.text,
      qFields,
      excludeDeleted: true,
      // No set of ids describes a sales representative's reach (issue #305);
      // `CustomerAccount` is `@OrgScoped`, so the owner's read is narrowed by
      // the tenant filter, which is that reach.
      allowedOrganizationIds: null,
      page: 1,
      pageSize: query.limit + 1,
    }),
    query.isUuid ? deps.accounts.findById(query.text) : Promise.resolve(null),
  ]);
  const visibleById =
    byId !== null &&
    byId.deletedAt === null &&
    byId.anonymizedAt === null &&
    (scope.isPlatformAdmin || (await orgInScope(byId.organizationId, scope.reach)))
      ? [byId]
      : [];
  const seen = new Set<string>();
  const ranked: CustomerAccountRecord[] = [];
  for (const record of [...visibleById, ...byText.rows]) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    ranked.push(record);
  }
  const page = ranked.slice(0, query.limit);
  const organizations =
    page.length === 0 ? [] : await deps.organizations.findByIds([...new Set(page.map((c) => c.organizationId))]);
  const organizationName = new Map(organizations.map((o) => [o.id, o.name]));
  return {
    hasMore: ranked.length > query.limit,
    rows: page.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      organizationName: organizationName.get(c.organizationId) ?? null,
      status: c.blockedAt ? 'blocked' : 'active',
    })),
  };
}

export interface CustomerAdminSearchProviderDeps {
  search(query: CustomerAdminSearchQuery, adminUserId: string): Promise<{ rows: CustomerAdminSearchRow[]; hasMore: boolean }>;
  translate(key: string, language: SupportedAdminLanguage): Promise<string>;
}

/**
 * The Customer provider — owned by `customers`, which owns the admin Customers
 * surface, its permission and its scope decision (research R-2), over
 * `customer_accounts`' published search port.
 */
export function createCustomerAdminSearchProvider(deps: CustomerAdminSearchProviderDeps): AdminSearchProvider {
  return {
    entityType: 'customers.customer',
    moduleId: 'customers',
    labelKey: 'adminSearch.group.label',
    icon: 'Users',
    requiredPermission: 'customers:read',
    weight: 500,
    fields: CUSTOMER_ADMIN_SEARCH_FIELDS,
    async search(query: AdminSearchProviderQuery) {
      const { rows, hasMore } = await deps.search(
        {
          text: query.text,
          likeEscaped: query.likeEscaped,
          isUuid: query.isUuid,
          fields: query.fields,
          limit: query.limit,
        },
        query.adminUserId,
      );
      const hits = await Promise.all(
        rows.map(async (row) => {
          const name = `${row.firstName} ${row.lastName}`.trim();
          return {
            id: row.id,
            title: name === '' ? row.email : name,
            subtitle: [row.email, row.organizationName].filter((part): part is string => Boolean(part)).join(' · '),
            status: {
              code: row.status,
              label: await deps.translate(CUSTOMER_ADMIN_SEARCH_STATUS_KEYS[row.status]!, query.language),
            },
            targetRoute: `/customers/${row.id}`,
          };
        }),
      );
      return { hits, hasMore };
    },
  };
}
