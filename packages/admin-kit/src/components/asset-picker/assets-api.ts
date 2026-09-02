import type { AssetDetail, ListAssetsResponse } from '@endora-commerce/contracts';
// `apiClient` and `apiBaseUrl` come through the kit's published `lib` **barrel**
// rather than through `../../lib/api-client.js` — see the note in
// `../sales-channel-picker/SalesChannelPicker.tsx`: the barrel is the only
// spelling `vi.mock` can name from outside the package.
import { apiBaseUrl, apiClient } from '../../lib/index.js';

/**
 * The three Assets-Library requests the kit's asset components make, and the
 * one a consumer needs to turn a stored asset id into something renderable.
 *
 * **The requests are built here** (feature 091, P4c). Until this landed the
 * asset components called `assets_library`' own admin API client, which is a
 * reach out of the platform's frontend into a module's admin code, and
 * `admin-kit-surface.md` R6 refused to publish them for it. P2 settled that an
 * HTTP path and a `@endora-commerce/contracts` schema are **not** module
 * knowledge — a module's *code* is — and Z1.1 measured that the asset cluster is
 * that same shape one component deeper. So the path is rebuilt and the shapes
 * are the owner's published ones, not duplicated.
 */

export interface AssetListQuery {
  /** `null` — the library root ("Unsorted"); a UUID — that folder. */
  folderId?: string | null;
  q?: string;
  mime?: string;
  visibility?: 'public' | 'private';
  cursor?: string;
  limit?: number;
}

export function listAssets(query: AssetListQuery): Promise<ListAssetsResponse> {
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
  return apiClient.get<ListAssetsResponse>(`/api/v1/admin/assets${qs ? `?${qs}` : ''}`);
}

/**
 * Resolve one asset id to its metadata.
 *
 * Published on `./components` beside the components that call it because five
 * screens outside `assets_library` do exactly this and nothing else with that
 * module's client — a stored id has to become a filename or a URL before it can
 * be rendered.
 */
export async function fetchAssetDetail(id: string): Promise<AssetDetail> {
  const out = await apiClient.get<{ data: AssetDetail }>(`/api/v1/admin/assets/${id}`);
  return out.data;
}

export interface AssetUploadFields {
  /** UUID of the target folder, or null for "Unsorted". */
  folderId?: string | null;
  label?: string | null;
  visibility?: 'public' | 'private';
}

/**
 * Upload a single file via multipart/form-data.
 *
 * The typed `apiClient` is JSON-only, so multipart goes through a direct
 * `fetch` over the same published origin. Visibility / folderId / label are
 * sent as fields BEFORE the file part so the server-side pipeline picks them up
 * before finalising the asset.
 */
export async function uploadAsset(
  file: File,
  fields: AssetUploadFields = {},
): Promise<AssetDetail> {
  const fd = new FormData();
  if (fields.visibility) fd.append('visibility', fields.visibility);
  if (fields.folderId !== undefined && fields.folderId !== null) {
    fd.append('folderId', fields.folderId);
  }
  if (fields.label !== undefined && fields.label !== null) {
    fd.append('label', fields.label);
  }
  fd.append('file', file, file.name);
  const r = await fetch(`${apiBaseUrl.replace(/\/+$/, '')}/api/v1/admin/assets`, {
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
}
