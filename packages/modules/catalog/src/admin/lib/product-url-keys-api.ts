import type {
  ProductUrlKeysResponse,
  UrlKeyRedirectTakeoverRequiredDetails,
  UrlKeyTakenDetails,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 163 (US7; `contracts/url-keys-and-redirects.md` §1–§3) — the product's redirects
 * (`…/url-keys`, `…/url-redirects/:id`) and the URL-key refusals in the operator's words.
 * Feature 170: the key itself is written by the editor's one Save (`PUT …/scoped-values`).
 */

export type ProductUrlKeys = ProductUrlKeysResponse['data'];

const productPath = (productId: string): string =>
  `/api/v1/admin/catalog/products/${encodeURIComponent(productId)}`;

export async function getProductUrlKeys(productId: string): Promise<ProductUrlKeys> {
  const res = await apiClient.get<ProductUrlKeysResponse>(`${productPath(productId)}/url-keys`);
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
