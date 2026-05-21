import { apiClient } from '@/lib/api-client';

/**
 * Typed wrapper for the Organization picker endpoint.
 *
 * The backend route lands in US8 (T121); for now the picker calls this
 * client which returns a `PickerPage`. The shape matches the contract
 * in specs/026-organizations/contracts/admin-organizations.openapi.yaml.
 *
 * The status filter accepts the four statuses introduced by feature 026.
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
  countryCode: string | null;
  salesRepAdminUserIds: string[];
  memberCount: number;
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

export const organizationsPickerClient = {
  list(options: ListOrganizationsForPickerOptions = {}): Promise<OrganizationPickerPage> {
    const qs = new URLSearchParams();
    if (options.q !== undefined && options.q.length > 0) qs.set('q', options.q);
    if (options.status && options.status.length > 0) {
      qs.set('status', options.status.join(','));
    }
    if (options.salesRepAdminUserId !== undefined) {
      qs.set('salesRepAdminUserId', options.salesRepAdminUserId);
    }
    if (options.limit !== undefined) qs.set('limit', String(options.limit));
    if (options.cursor) qs.set('cursor', options.cursor);
    const tail = qs.toString();
    return apiClient.get<OrganizationPickerPage>(
      `/api/v1/admin/organizations${tail ? `?${tail}` : ''}`,
      options.signal ? { signal: options.signal } : undefined,
    );
  },
};
