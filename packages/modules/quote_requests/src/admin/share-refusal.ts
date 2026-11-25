import { ApiError } from '@endora-commerce/admin-kit/lib';
import { ERROR_CODES } from '@endora-commerce/contracts';

// `specs/192-quote-request-draft-share/` — why `POST …/:id/share` was refused,
// read once for the detail screen and for the create screen's *Create and
// share* (which hands it to the detail screen through navigation state).
//
// The sentence is the server's: the error envelope's `message` is already in
// the operator's language, token sentences included (`RFQ_SHARE_CUSTOMER_UNAVAILABLE`
// `not_member` / `inactive` / `blocked`, `QUOTE_INCOMPLETE` `share`), and a
// share hook of another module words its own refusal. What the screen adds is
// the unpriced lines `QUOTE_INCOMPLETE` names in `details.lines` (FR-026).

/**
 * The `details.code` token a `QUOTE_INCOMPLETE` share refusal carries (the
 * manifest's `{ code: 'QUOTE_INCOMPLETE', tokens: ['share'] }`). The contracts
 * export no details schema for it, so the token is named once here.
 */
export const QUOTE_INCOMPLETE_SHARE_TOKEN = 'share';

/**
 * The screen's own code for a share that failed without a refusal (a network
 * failure): there is no envelope, so the sentence is the screen's `share.error`.
 * Not an API code — nothing on the server answers it.
 */
export const SHARE_FAILED_CODE = 'SHARE_FAILED';

export interface ShareRefusalLine {
  id: string;
  productName: string;
  variantLabel: string | null;
  groupName: string | null;
}

export interface ShareRefusal {
  /** The envelope's code — `RFQ_ALREADY_SHARED` and `VERSION_CONFLICT` re-read the quote. */
  code: string;
  message: string;
  /** The unpriced lines of a `QUOTE_INCOMPLETE` / `share` refusal, in display order; else empty. */
  lines: ShareRefusalLine[];
}

function readLines(details: unknown): ShareRefusalLine[] {
  if (typeof details !== 'object' || details === null) return [];
  const { code, lines } = details as { code?: unknown; lines?: unknown };
  if (code !== QUOTE_INCOMPLETE_SHARE_TOKEN) return [];
  return shareRefusalLinesOf(lines);
}

/**
 * The well-formed unpriced lines in `lines`: an entry without a string `id` and
 * `productName` is dropped, anything that is not an array reads as none. Shared
 * by the error envelope and by the navigation state the detail screen arrives with.
 */
export function shareRefusalLinesOf(lines: unknown): ShareRefusalLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.flatMap((line): ShareRefusalLine[] => {
    if (typeof line !== 'object' || line === null) return [];
    const l = line as Record<string, unknown>;
    if (typeof l['id'] !== 'string' || typeof l['productName'] !== 'string') return [];
    return [
      {
        id: l['id'],
        productName: l['productName'],
        variantLabel: typeof l['variantLabel'] === 'string' ? l['variantLabel'] : null,
        groupName: typeof l['groupName'] === 'string' ? l['groupName'] : null,
      },
    ];
  });
}

/** The refusal an `ApiError` carries; `null` for anything else (a network failure). */
export function shareRefusalOf(err: unknown): ShareRefusal | null {
  if (!(err instanceof ApiError)) return null;
  const { code, message, details } = err.envelope.error as { code: string; message: string; details?: unknown };
  return { code, message, lines: code === ERROR_CODES.QUOTE_INCOMPLETE ? readLines(details) : [] };
}

/** Whether the refusal means the screen shows an older version of the quote than the server holds. */
export function shareRefusalNeedsReread(refusal: ShareRefusal): boolean {
  return shareRefusalIsAlreadyShared(refusal) || refusal.code === ERROR_CODES.VERSION_CONFLICT;
}

/**
 * Somebody else shared the quote meanwhile: what the operator asked for is
 * done, so the screen says it as news, not as an error.
 */
export function shareRefusalIsAlreadyShared(refusal: ShareRefusal): boolean {
  return refusal.code === ERROR_CODES.RFQ_ALREADY_SHARED;
}

/** The share waits for agreed prices: the remedy is the Modify tab. */
export function shareRefusalWantsPrices(refusal: ShareRefusal): boolean {
  return refusal.code === ERROR_CODES.QUOTE_INCOMPLETE;
}
