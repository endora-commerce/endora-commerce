import type {
  CopyScopedValueRequest,
  CopyScopedValueResponse,
  ProductEditorPreferenceResponse,
  SaveScopedValuesRequest,
  SaveScopedValuesResponse,
  ScopeRef,
  ScopedValuesResponse,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { scopeToRequest } from './scoped-editor-store.js';

/**
 * Feature 174 (T093, `contracts/scoped-values-api.md` §2, §3, §5) — the product editor's
 * one read per scope, one save of a scope, and the remembered scope. Replaces the editor's
 * calls to the removed `…/scope-context` and `…/value-overrides` routes.
 */

const productPath = (productId: string): string =>
  `/api/v1/admin/catalog/products/${encodeURIComponent(productId)}`;

/** The query string of a scope read: `?channelId=…&languageCode=…`, empty at Global. */
export function scopeQuery(scope: ScopeRef): string {
  const request = scopeToRequest(scope);
  const params = new URLSearchParams();
  if (request.channelId) params.set('channelId', request.channelId);
  if (request.languageCode) params.set('languageCode', request.languageCode);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** §2 — every field at one scope, with its source. */
export function getScopedValues(productId: string, scope: ScopeRef): Promise<ScopedValuesResponse> {
  return apiClient.get<ScopedValuesResponse>(`${productPath(productId)}/scoped-values${scopeQuery(scope)}`);
}

/** §3 — one atomic save of the staged cells at one scope. */
export function saveScopedValues(
  productId: string,
  body: SaveScopedValuesRequest,
): Promise<SaveScopedValuesResponse> {
  return apiClient.put<SaveScopedValuesResponse>(`${productPath(productId)}/scoped-values`, body);
}

/** §4 — copy one own value at C×L to other channels in the same language; `dryRun` plans it only. */
export function copyScopedValue(productId: string, body: CopyScopedValueRequest): Promise<CopyScopedValueResponse> {
  return apiClient.post<CopyScopedValueResponse>(`${productPath(productId)}/scoped-values/copy`, body);
}

/** §5 — the scope this admin last edited the product at; `null` before the first visit. */
export async function getEditorPreference(productId: string): Promise<ScopeRef | null> {
  const res = await apiClient.get<{ data: ProductEditorPreferenceResponse | null }>(
    `${productPath(productId)}/editor-preference`,
  );
  const pref = res.data;
  if (!pref || !pref.lastChannelId) return pref ? { level: 'global' } : null;
  return pref.lastLanguageCode
    ? { level: 'channel_language', channelId: pref.lastChannelId, languageCode: pref.lastLanguageCode }
    : { level: 'channel', channelId: pref.lastChannelId };
}

/** §5 — remember the scope; best effort, a refusal is not the operator's problem. */
export async function putEditorPreference(productId: string, scope: ScopeRef): Promise<void> {
  const request = scopeToRequest(scope);
  try {
    await apiClient.put(`${productPath(productId)}/editor-preference`, {
      lastChannelId: request.channelId ?? null,
      lastLanguageCode: request.languageCode ?? null,
    });
  } catch {
    // UI preference only.
  }
}
