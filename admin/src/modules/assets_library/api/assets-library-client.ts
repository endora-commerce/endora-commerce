// Typed admin client for the Assets Library — feature 013 / US1.
//
// Wraps the shared `apiClient` with strong response types inferred from
// `@b2b/contracts/assets-library`. Components consume this rather than
// touching `apiClient` directly.

import { apiClient } from '@/lib/api-client';
import type {
  AssetDetail,
  AssetSummary,
  ListAssetsResponse,
  PatchAssetRequest,
} from '@b2b/contracts';

export type { AssetSummary, AssetDetail };

export interface UploadFields {
  /** UUID of the target folder, or null for "Unsorted". */
  folderId?: string | null;
  label?: string | null;
  visibility?: 'public' | 'private';
}

export const assetsLibraryClient = {
  async listAssets(query: {
    folderId?: string | null;
    q?: string;
    mime?: string;
    visibility?: 'public' | 'private';
    cursor?: string;
    limit?: number;
  }): Promise<ListAssetsResponse> {
    const params = new URLSearchParams();
    if (query.folderId !== undefined && query.folderId !== null) {
      params.set('folderId', query.folderId);
    }
    if (query.q) params.set('q', query.q);
    if (query.mime) params.set('mime', query.mime);
    if (query.visibility) params.set('visibility', query.visibility);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const qs = params.toString();
    return apiClient.get<ListAssetsResponse>(
      `/api/v1/admin/assets${qs ? `?${qs}` : ''}`,
    );
  },

  async getAsset(id: string): Promise<AssetDetail> {
    const out = await apiClient.get<{ data: AssetDetail }>(
      `/api/v1/admin/assets/${id}`,
    );
    return out.data;
  },

  async getAssetUrl(id: string): Promise<{ url: string; expiresAt: string | null }> {
    const out = await apiClient.get<{ data: { url: string; expiresAt: string | null } }>(
      `/api/v1/admin/assets/${id}/url`,
    );
    return out.data;
  },

  async patchAsset(id: string, patch: PatchAssetRequest): Promise<AssetDetail> {
    const out = await apiClient.patch<{ data: AssetDetail }>(
      `/api/v1/admin/assets/${id}`,
      patch,
    );
    return out.data;
  },

  /**
   * Upload a single file via multipart/form-data. We bypass the typed
   * `apiClient` here because it is JSON-only — multipart goes through a
   * direct `fetch`. Visibility / folderId / label are sent as fields BEFORE
   * the file part so the server-side pipeline picks them up before
   * finalising the asset.
   */
  async uploadAsset(file: File, fields: UploadFields = {}): Promise<AssetDetail> {
    const baseUrl =
      (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
    const fd = new FormData();
    if (fields.visibility) fd.append('visibility', fields.visibility);
    if (fields.folderId !== undefined && fields.folderId !== null) {
      fd.append('folderId', fields.folderId);
    }
    if (fields.label !== undefined && fields.label !== null) {
      fd.append('label', fields.label);
    }
    fd.append('file', file, file.name);
    const r = await fetch(`${baseUrl}/api/v1/admin/assets`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`Upload failed (${r.status}): ${text}`);
    }
    const json = (await r.json()) as { data: AssetDetail };
    return json.data;
  },
};
