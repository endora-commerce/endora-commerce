import type { AttributeScopeChangePreviewResponse } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 170 (FR-012, R15) — an attribute's one `scopable` flag and the preview of narrowing
 * it (`contracts/admin-scopes-api.md` §6). A scopable attribute takes Channel overrides and,
 * when its type is text (`string`), Channel × language overrides too.
 */

export interface AttributeScopeInput {
  scopable: boolean;
  valueType: string;
}

export type AttributeScopePreview = AttributeScopeChangePreviewResponse['data'];

/**
 * A change narrows when values already set at a level stop applying: the flag going off, or a
 * scopable text attribute becoming another type (its Channel × language values).
 */
export function isScopeNarrowing(current: AttributeScopeInput, next: AttributeScopeInput): boolean {
  if (current.scopable && !next.scopable) return true;
  return current.scopable && next.scopable && current.valueType === 'string' && next.valueType !== 'string';
}

/** The stored flag, or `null` when the answer does not carry it. */
export function scopableOf(attribute: { scopable?: unknown }): boolean | null {
  return typeof attribute.scopable === 'boolean' ? attribute.scopable : null;
}

/** `GET …/attributes/:key/scope-change-preview?scopable=…&valueType=…`. */
export async function previewAttributeScopeChange(
  attributeKey: string,
  next: AttributeScopeInput,
): Promise<AttributeScopePreview> {
  const qs = new URLSearchParams({ scopable: String(next.scopable), valueType: next.valueType }).toString();
  const res = await apiClient.get<AttributeScopeChangePreviewResponse>(
    `/api/v1/admin/catalog/attributes/${encodeURIComponent(attributeKey)}/scope-change-preview?${qs}`,
  );
  return res.data;
}
