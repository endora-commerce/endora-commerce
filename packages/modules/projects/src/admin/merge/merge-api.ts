import type {
  ProjectMergeFieldCode,
  ProjectMergePreview,
  ProjectMergeView,
  RecordMergeChoice,
  RecordMergeState,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * The Project merge's admin API (`specs/192-organization-merge/` US6,
 * `contracts/project-merge.md` §3), as the merge screens call it.
 */
export interface ProjectMergeStartRequest {
  readonly loserId: string;
  readonly fieldChoices: Partial<Record<ProjectMergeFieldCode, RecordMergeChoice>>;
  readonly customFieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly acknowledgeIrreversible: true;
  /** FR-090 — the preview's Organizations gaining access, confirmed apart. */
  readonly acknowledgedOrganizationIds?: readonly string[];
}

const MERGES = '/api/v1/admin/project-merges';

export const projectMergesApi = {
  async preview(survivorId: string, loserId: string): Promise<ProjectMergePreview> {
    const res = await apiClient.post<{ data: ProjectMergePreview }>(`/api/v1/admin/projects/${survivorId}/merge-preview`, {
      loserId,
    });
    return res.data;
  },

  async start(survivorId: string, request: ProjectMergeStartRequest): Promise<ProjectMergeView> {
    const res = await apiClient.post<{ data: ProjectMergeView }>(`/api/v1/admin/projects/${survivorId}/merges`, request);
    return res.data;
  },

  async list(query: { readonly state?: RecordMergeState; readonly projectId?: string } = {}): Promise<ProjectMergeView[]> {
    const params = new URLSearchParams();
    if (query.state !== undefined) params.set('state', query.state);
    if (query.projectId !== undefined) params.set('projectId', query.projectId);
    const search = params.toString();
    const res = await apiClient.get<{ data: ProjectMergeView[] }>(search.length > 0 ? `${MERGES}?${search}` : MERGES);
    return res.data;
  },

  async get(mergeId: string): Promise<ProjectMergeView> {
    const res = await apiClient.get<{ data: ProjectMergeView }>(`${MERGES}/${mergeId}`);
    return res.data;
  },

  async resume(mergeId: string, expectedVersion: number): Promise<ProjectMergeView> {
    const res = await apiClient.post<{ data: ProjectMergeView }>(`${MERGES}/${mergeId}/resume`, { expectedVersion });
    return res.data;
  },

  async cancel(mergeId: string, expectedVersion: number): Promise<ProjectMergeView> {
    const res = await apiClient.post<{ data: ProjectMergeView }>(`${MERGES}/${mergeId}/cancel`, { expectedVersion });
    return res.data;
  },
};
