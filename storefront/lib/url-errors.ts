import type { StorefrontApiError } from './api/client';
import type { MessageKey } from './i18n/messages';

/**
 * What a page's `?error=` (or `?reason=`) may say (issue #745).
 *
 * **A code travels, never a sentence** — the rule of
 * `lib/account/organization-roles.ts`, `lib/account/organization-members.ts`
 * and `lib/account/org-cart-approval.ts`. A server action answers with a
 * redirect, so whatever it reports is in the URL, and a sentence there is text
 * anyone can put on the page as a system message with a crafted link. The page
 * names a code it knows in its own language and reads anything else as its
 * generic failure. No personal data travels either: a code names what went
 * wrong, never whose address it was.
 *
 * A vocabulary has two halves. `api` holds the API codes the page can name —
 * an `error.code` the backend answers, or `<code>.<details.code>` where the
 * backend tells one refusal of a code apart from another (the keys of its
 * `errors.*` bundles have the same shape). `own` holds the storefront's codes:
 * each action's own fallback, for a refusal the page cannot name or a request
 * that never reached the API, and `generic`, what any other code reads as.
 * An API answer naming one of the `own` codes is not taken at its word.
 */
export interface UrlErrorVocabulary<Api extends string, Own extends string> {
  /** The code a failed action carries: the API's own when the page names it, `fallback` otherwise. */
  failureCode(err: unknown, fallback: Own): Api | Own;
  /** The sentence for `?error=<code>`, or `null` when there is no error parameter. */
  errorKey(code: string | undefined): MessageKey | null;
  /** Whether `code` is one the page names (an unknown one still reads as the generic failure). */
  isCode(code: string): code is Api | Own;
}

function has<T extends object>(table: T, key: string): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(table, key);
}

/**
 * Whether `err` is the API's refusal. Read by shape rather than by `instanceof`: this module is
 * reached from client components (`lib/cartMinimum.ts`), and `api/client` reaches `next/headers`.
 */
function isApiError(err: unknown): err is Pick<StorefrontApiError, 'status' | 'code' | 'detail' | 'details'> {
  if (!(err instanceof Error)) return false;
  const candidate = err as Partial<Record<'status' | 'code' | 'detail', unknown>>;
  return typeof candidate.status === 'number' && typeof candidate.code === 'string' && typeof candidate.detail === 'string';
}

/** The refinement the backend put in `details.code`, if any. */
function detailsCode(err: Pick<StorefrontApiError, 'details'>): string | null {
  const details = err.details;
  if (details === null || typeof details !== 'object') return null;
  const code = (details as { code?: unknown }).code;
  return typeof code === 'string' && code !== '' ? code : null;
}

export function defineUrlErrors<
  const Api extends Readonly<Record<string, MessageKey>>,
  const Own extends Readonly<Record<string, MessageKey>>,
>(vocabulary: {
  api: Api & { readonly [K in keyof Own]?: never };
  own: Own;
  generic: Extract<keyof Own, string>;
}): UrlErrorVocabulary<Extract<keyof Api, string>, Extract<keyof Own, string>> {
  const { api, own, generic } = vocabulary;
  type A = Extract<keyof Api, string>;
  type O = Extract<keyof Own, string>;
  return {
    failureCode(err: unknown, fallback: O): A | O {
      if (!isApiError(err)) return fallback;
      const refinement = detailsCode(err);
      if (refinement !== null) {
        const refined = `${err.code}.${refinement}`;
        if (has(api, refined)) return refined as A;
      }
      return has(api, err.code) ? (err.code as A) : fallback;
    },
    errorKey(code: string | undefined): MessageKey | null {
      if (code === undefined || code === '') return null;
      if (has(api, code)) return api[code] as MessageKey;
      if (has(own, code)) return own[code] as MessageKey;
      return own[generic] as MessageKey;
    },
    isCode(code: string): code is A | O {
      return has(api, code) || has(own, code);
    },
  };
}
