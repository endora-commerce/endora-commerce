// Typed I/O against the Admin UI i18n endpoints — feature 019 /
// contracts/admin-http.md. No UI here; just the contract calls.
//
// Both endpoints return the project-standard `{ data: ... }` envelope
// (packages/contracts/src/envelopes.ts) — these helpers unwrap it so
// the SPA's TranslationProvider receives the bare payload.

import { apiClient } from '../lib/api-client.js';
import type {
  GetBundlesResponse,
  PatchPreferredLanguageBody,
  SupportedAdminLanguage,
} from '@b2b/contracts';

export async function getBundles(
  language: SupportedAdminLanguage,
): Promise<GetBundlesResponse> {
  const res = await apiClient.get<{ data: GetBundlesResponse }>(
    `/api/v1/admin/i18n/bundles?language=${encodeURIComponent(language)}`,
  );
  return res.data;
}

/**
 * Hot-reload translations: re-reads every module's on-disk i18n bundles into
 * the DB (feature: i18n reload). The caller should refresh the page afterwards
 * so the new strings are fetched.
 */
export async function reloadBundles(): Promise<{
  installed: number;
  skipped: number;
  failed: number;
}> {
  const res = await apiClient.post<{
    data: { installed: number; skipped: number; failed: number };
  }>('/api/v1/admin/i18n/reload', {});
  return res.data;
}

export async function setPreferredLanguage(
  preferredLanguage: SupportedAdminLanguage | null,
): Promise<{ preferredLanguage: SupportedAdminLanguage | null }> {
  const body: PatchPreferredLanguageBody = { preferredLanguage };
  const res = await apiClient.patch<{
    data: { preferredLanguage: SupportedAdminLanguage | null };
  }>('/api/v1/admin/me/preferred-language', body);
  return res.data;
}
