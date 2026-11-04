import { StorefrontApiError } from '../api/client';
import type { MessageKey } from '../i18n/messages';

/**
 * The approve / reject answers of `/organization/carts/[id]` (issue #650):
 * what travels from a server action back to the page, and what the page says
 * about it. Pure, so the page and the actions share one vocabulary.
 *
 * **A code travels, never a sentence.** The action answers with a redirect, so
 * whatever it reports is in the URL; a sentence there is text anyone can put on
 * an administrator's page with a crafted link. The page names a code it knows in
 * its own language and reads anything else as {@link FAILED}.
 */

/** The longest reason `POST /organization/carts/:id/reject` accepts (`rejectOrgCartSchema`). */
export const REJECT_REASON_MAX_LENGTH = 2000;

const FAILED = 'FAILED';

const ERROR_KEYS = {
  CART_APPROVAL_NOT_PENDING: 'account.orgCart.error.CART_APPROVAL_NOT_PENDING',
  // Feature 170 (FR-032): one's own pending cart, and a role without `carts.approve`.
  CART_APPROVAL_SELF_APPROVE: 'account.orgCart.error.CART_APPROVAL_SELF_APPROVE',
  ORGANIZATION_PERMISSION_REQUIRED: 'account.orgCart.error.ORGANIZATION_PERMISSION_REQUIRED',
  NOT_FOUND: 'account.orgCart.error.NOT_FOUND',
  FORBIDDEN: 'account.orgCart.error.FORBIDDEN',
  REASON_REQUIRED: 'account.orgCart.error.REASON_REQUIRED',
  REASON_TOO_LONG: 'account.orgCart.error.REASON_TOO_LONG',
  [FAILED]: 'account.orgCart.error.FAILED',
} as const satisfies Record<string, MessageKey>;

export type OrgCartErrorCode = keyof typeof ERROR_KEYS;

function isKnown(code: string): code is OrgCartErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_KEYS, code);
}

/** The code a failed approve or reject reports: the API's own when the page can name it. */
export function orgCartFailureCode(err: unknown): OrgCartErrorCode {
  return err instanceof StorefrontApiError && isKnown(err.code) ? err.code : FAILED;
}

/** The sentence for `?error=<code>`, or `null` when there is no error parameter. */
export function orgCartErrorKey(code: string | undefined): MessageKey | null {
  if (code === undefined || code === '') return null;
  return ERROR_KEYS[isKnown(code) ? code : FAILED];
}

/** The sentence for `?done=approved|rejected`, or `null`. */
export function orgCartDoneKey(done: string | undefined): MessageKey | null {
  if (done === 'approved') return 'account.orgCart.done.approved';
  if (done === 'rejected') return 'account.orgCart.done.rejected';
  return null;
}

/**
 * A rejection reason as typed: trimmed, and refused before any request when
 * it is blank or longer than the API accepts.
 */
export function parseRejectReason(
  raw: FormDataEntryValue | null,
): { ok: true; reason: string } | { ok: false; code: 'REASON_REQUIRED' | 'REASON_TOO_LONG' } {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason === '') return { ok: false, code: 'REASON_REQUIRED' };
  if (reason.length > REJECT_REASON_MAX_LENGTH) return { ok: false, code: 'REASON_TOO_LONG' };
  return { ok: true, reason };
}
