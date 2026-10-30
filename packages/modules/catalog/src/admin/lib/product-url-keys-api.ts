import type {
  ProductUrlKeysResponse,
  PutProductUrlKeysRequest,
  UrlKeyRedirectTakeoverRequiredDetails,
  UrlKeyTakenDetails,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 163 (US7; `contracts/url-keys-and-redirects.md` §1–§3) — the product editor's
 * calls to `…/url-keys` and `…/url-redirects/:id`, and the refusals in the operator's
 * words. Effective URLs are the response's `url`: the admin never composes one.
 */

export type ProductUrlKeys = ProductUrlKeysResponse['data'];

const productPath = (productId: string): string =>
  `/api/v1/admin/catalog/products/${encodeURIComponent(productId)}`;

export async function getProductUrlKeys(productId: string): Promise<ProductUrlKeys> {
  const res = await apiClient.get<ProductUrlKeysResponse>(`${productPath(productId)}/url-keys`);
  return res.data;
}

/** One Command, one audit entry; absent lists are untouched, `key: null` inherits. */
export async function putProductUrlKeys(productId: string, body: PutProductUrlKeysRequest): Promise<ProductUrlKeys> {
  const res = await apiClient.put<ProductUrlKeysResponse>(`${productPath(productId)}/url-keys`, body);
  return res.data;
}

export async function deleteProductUrlRedirect(productId: string, redirectId: string): Promise<void> {
  await apiClient.delete(`${productPath(productId)}/url-redirects/${encodeURIComponent(redirectId)}`);
}

type Translate = (key: string, params?: Record<string, string>) => string;

function errorOf(err: unknown): { code: string; details?: Record<string, unknown> } | null {
  if (!(err instanceof ApiError)) return null;
  return err.envelope.error as { code: string; details?: Record<string, unknown> };
}

/** `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` details, or `null` for any other answer. */
export function takeoverDetails(err: unknown): UrlKeyRedirectTakeoverRequiredDetails | null {
  const error = errorOf(err);
  if (error?.code !== 'URL_KEY_REDIRECT_TAKEOVER_REQUIRED' || !error.details) return null;
  const takeovers = error.details['takeovers'];
  return Array.isArray(takeovers) ? { takeovers: takeovers as UrlKeyRedirectTakeoverRequiredDetails['takeovers'] } : null;
}

/** `URL_KEY_TAKEN` details, or `null` for any other answer. */
export function takenDetails(err: unknown): UrlKeyTakenDetails | null {
  const error = errorOf(err);
  if (error?.code !== 'URL_KEY_TAKEN' || !error.details) return null;
  const conflicts = error.details['conflicts'];
  return Array.isArray(conflicts) ? { conflicts: conflicts as UrlKeyTakenDetails['conflicts'] } : null;
}

/** `drill (EN)` — a key and the language it is held in; a language-less one is every language. */
export function describeKeyInLanguage(key: string, languageCode: string | null, t: Translate): string {
  return languageCode === null
    ? t('productEditor.urlKeys.keyEveryLanguage', { key })
    : t('productEditor.urlKeys.keyInLanguage', { key, language: languageCode.toUpperCase() });
}

/**
 * A refused URL-key write as one sentence naming who holds the key, or `null` when the
 * refusal is not about URL keys (the caller then says what it says for other errors).
 */
export function urlKeyErrorMessage(err: unknown, t: Translate): string | null {
  const taken = takenDetails(err);
  if (taken) {
    return t('productEditor.urlKeys.error.taken', {
      conflicts: taken.conflicts
        .map((c) =>
          t('productEditor.urlKeys.error.takenBy', {
            key: describeKeyInLanguage(c.key, c.languageCode, t),
            product: c.heldByProductName,
          }),
        )
        .join('; '),
    });
  }
  const error = errorOf(err);
  if (error?.code === 'URL_REDIRECT_NOT_FOUND') return t('productEditor.urlKeys.error.redirectGone');
  if (error?.code === 'VALIDATION_FAILED' && error.details?.['field'] === 'languageKeys') {
    return t('productEditor.urlKeys.error.languageNotOffered');
  }
  return null;
}

/**
 * What the panel holds while the operator edits: an empty string is "use inherited".
 * A channel × language row absent from `channelKeys` was removed.
 */
export interface UrlKeysDraft {
  globalKey: string;
  /** 168-shim: always empty — there is no Language key any more (FR-010); S3 rewrites this panel. */
  languageKeys: Record<string, string>;
  /** `languageCode` `null` = the Channel key. */
  channelKeys: Array<{ channelId: string; languageCode: string | null; key: string }>;
}

/** Postel: a pasted key is trimmed and lower-cased before it is compared or sent. */
export function normalizeUrlKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The PUT body for what changed between the saved keys and the draft, or `null` when
 * nothing did. Saved entries come first in their saved order, new ones after them; a
 * key emptied or a row removed is sent as `key: null` (use inherited).
 */
export function urlKeysChanges(saved: ProductUrlKeys, draft: UrlKeysDraft): PutProductUrlKeysRequest | null {
  const body: PutProductUrlKeysRequest = {};

  const globalKey = normalizeUrlKey(draft.globalKey);
  if (globalKey !== '' && globalKey !== saved.globalKey) body.globalKey = globalKey;

  const scopeOf = (k: { channelId: string; languageCode: string | null }): string =>
    `${k.channelId}|${k.languageCode ?? ''}`;
  const savedChannel = new Map(saved.channelKeys.map((k) => [scopeOf(k), k]));
  const draftChannel = new Map(draft.channelKeys.map((k) => [scopeOf(k), k]));
  const channelKeys: NonNullable<PutProductUrlKeysRequest['channelKeys']> = [];
  for (const [scope, row] of savedChannel) {
    const next = normalizeUrlKey(draftChannel.get(scope)?.key ?? '') || null;
    // The write encoding (FR-116): a removed key inherits — `{ inherit: true }`, never `null`.
    if (next !== row.key) {
      channelKeys.push({ channelId: row.channelId, languageCode: row.languageCode, key: next ?? { inherit: true } });
    }
  }
  for (const [scope, row] of draftChannel) {
    if (savedChannel.has(scope)) continue;
    const next = normalizeUrlKey(row.key);
    if (next !== '') channelKeys.push({ channelId: row.channelId, languageCode: row.languageCode, key: next });
  }
  if (channelKeys.length > 0) body.channelKeys = channelKeys;

  return Object.keys(body).length > 0 ? body : null;
}
