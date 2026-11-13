import type { CustomerGroup, CustomerGroupListResponse } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * Typed admin client for customer groups (feature 076, D-79).
 *
 * The endpoints moved from `price_lists` to `customer_accounts` without
 * changing path or payload, so this client is the same three calls the
 * `CustomerGroupPicker` has always made — plus the two writes, which had no
 * caller in the SPA at all until this screen.
 */
/** A group as the admin API answers it — the published `customerGroupSchema` (issue #599). */
export type AdminCustomerGroup = CustomerGroup;

export interface CustomerGroupUpsertBody {
  code: string;
  name: string;
  description?: string | null;
}

export const customerGroupsClient = {
  list(): Promise<AdminCustomerGroup[]> {
    return apiClient
      .get<CustomerGroupListResponse>('/api/v1/admin/customer-groups')
      .then((r) => r.data);
  },
  upsert(code: string, body: CustomerGroupUpsertBody): Promise<AdminCustomerGroup> {
    return apiClient
      .put<{ data: AdminCustomerGroup }>(
        `/api/v1/admin/customer-groups/${encodeURIComponent(code)}`,
        body,
      )
      .then((r) => r.data);
  },
  remove(id: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/admin/customer-groups/${id}`);
  },
};
