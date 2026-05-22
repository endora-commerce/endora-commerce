import { apiClient } from '@/lib/api-client';

/**
 * Typed wrapper for the Organization picker endpoint.
 *
 * Calls the existing admin organizations list endpoint
 * `GET /api/v1/admin/organizations` and maps its
 * `{ data: [...], pagination: { ... } }` envelope to the
 * `OrganizationPickerPage` shape the React picker consumes. The endpoint
 * supports diacritic-insensitive search via the denormalized
 * `name_search` column populated server-side by feature 026's entity
 * hooks.
 *
 * The `status` filter accepts the four lifecycle statuses introduced by
 * feature 026. The current endpoint only supports a single status value
 * (per the legacy `filter[status]` query param) — when the picker passes
 * multiple statuses we take the first one; future iterations may
 * upgrade the route to OR-multiple-statuses if needed.
 */
export type OrganizationStatusPickerFilter =
  | 'pending_verification'
  | 'active'
  | 'blocked'
  | 'rejected';

export interface OrganizationPickerListItem {
  id: string;
  name: string;
  legalName: string | null;
  status: OrganizationStatusPickerFilter;
  countryCode?: string | null;
  salesRepAdminUserIds?: string[];
  memberCount?: number;
  version: number;
}

export interface OrganizationPickerPage {
  items: OrganizationPickerListItem[];
  nextCursor: string | null;
}

export interface ListOrganizationsForPickerOptions {
  q?: string;
  status?: OrganizationStatusPickerFilter[];
  salesRepAdminUserId?: string;
  limit?: number;
  cursor?: string | null;
  signal?: AbortSignal;
}

interface AdminOrgListResponse {
  data: Array<{
    id: string;
    name: string;
    legalName?: string | null;
    status: OrganizationStatusPickerFilter;
    version?: number;
    registeredAddress?: { country?: string };
  }>;
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

export const organizationsPickerClient = {
  async list(options: ListOrganizationsForPickerOptions = {}): Promise<OrganizationPickerPage> {
    const qs = new URLSearchParams();
    if (options.q !== undefined && options.q.length > 0) qs.set('q', options.q);
    if (options.status && options.status.length > 0) {
      // The current endpoint accepts a single status — pass the first.
      qs.set('filter[status]', options.status[0]!);
    }
    if (options.limit !== undefined) qs.set('limit', String(options.limit));
    const tail = qs.toString();
    const init = options.signal ? { signal: options.signal } : undefined;
    const res = await apiClient.get<AdminOrgListResponse>(
      `/api/v1/admin/organizations${tail ? `?${tail}` : ''}`,
      init,
    );
    return {
      items: res.data.map((o) => ({
        id: o.id,
        name: o.name,
        legalName: o.legalName ?? null,
        status: o.status,
        countryCode: o.registeredAddress?.country ?? null,
        version: o.version ?? 0,
      })),
      nextCursor: res.pagination.cursor ?? null,
    };
  },
};
