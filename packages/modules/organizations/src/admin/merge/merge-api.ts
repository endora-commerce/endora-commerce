import type {
  OrganizationMergeFieldCode,
  OrganizationMergePreview,
  OrganizationMergeView,
  RecordMergeChoice,
  RecordMergeState,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * The Organization merge's admin API (`specs/192-organization-merge/`
 * `contracts/organization-merge.md` §4), as the merge screens call it.
 */
export interface OrganizationMergeStartRequest {
  readonly loserId: string;
  readonly fieldChoices: Partial<Record<OrganizationMergeFieldCode, RecordMergeChoice>>;
  readonly customFieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly acknowledgeIrreversible: true;
}

const MERGES = '/api/v1/admin/organization-merges';

export const organizationMergesApi = {
  async preview(survivorId: string, loserId: string): Promise<OrganizationMergePreview> {
    const res = await apiClient.post<{ data: OrganizationMergePreview }>(
      `/api/v1/admin/organizations/${survivorId}/merge-preview`,
      { loserId },
    );
    return res.data;
  },

  async start(survivorId: string, request: OrganizationMergeStartRequest): Promise<OrganizationMergeView> {
    const res = await apiClient.post<{ data: OrganizationMergeView }>(`/api/v1/admin/organizations/${survivorId}/merges`, request);
    return res.data;
  },

  async list(query: { readonly state?: RecordMergeState; readonly organizationId?: string } = {}): Promise<OrganizationMergeView[]> {
    const params = new URLSearchParams();
    if (query.state !== undefined) params.set('state', query.state);
    if (query.organizationId !== undefined) params.set('organizationId', query.organizationId);
    const search = params.toString();
    const res = await apiClient.get<{ data: OrganizationMergeView[] }>(search.length > 0 ? `${MERGES}?${search}` : MERGES);
    return res.data;
  },

  async get(mergeId: string): Promise<OrganizationMergeView> {
    const res = await apiClient.get<{ data: OrganizationMergeView }>(`${MERGES}/${mergeId}`);
    return res.data;
  },

  async resume(mergeId: string, expectedVersion: number): Promise<OrganizationMergeView> {
    const res = await apiClient.post<{ data: OrganizationMergeView }>(`${MERGES}/${mergeId}/resume`, { expectedVersion });
    return res.data;
  },

  async cancel(mergeId: string, expectedVersion: number): Promise<OrganizationMergeView> {
    const res = await apiClient.post<{ data: OrganizationMergeView }>(`${MERGES}/${mergeId}/cancel`, { expectedVersion });
    return res.data;
  },
};
