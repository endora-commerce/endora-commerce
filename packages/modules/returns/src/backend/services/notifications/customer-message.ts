/**
 * Which e-mail a case's filer receives, and where (`specs/181-guest-complaints/`
 * research R-7) — the one decision every customer-facing message goes through:
 * `dispatch.ts`' confirmation, comment and status e-mails, and the authorized and
 * rejected e-mails of `return-email-notifier.ts`.
 *
 * - **An account's case** keeps 180's template, addressed to the account; the account
 *   decides whether an address exists, exactly as before.
 * - **A guest's case** (no account) gets the guest twin, addressed to the verified
 *   contact address. Every twin carries the tracking link where the account template
 *   links the account, so an operator who edited an account template never sends a
 *   guest an e-mail with no way back (research R-7, rejected alternative).
 * - **An erased guest case** gets nothing (FR-072): its address is gone, and so is any
 *   reason to write to it.
 */

export const GUEST_TWINS = {
  return_submitted: 'return_guest_submitted',
  return_comment_added: 'return_guest_comment_added',
  return_status_entered: 'return_guest_status_entered',
  return_authorized: 'return_guest_authorized',
  return_rejected: 'return_guest_rejected',
} as const;

export type AccountMessageCode = keyof typeof GUEST_TWINS;
export type GuestMessageCode = (typeof GUEST_TWINS)[AccountMessageCode];

/** What the decision reads of a case. */
export interface MessageCase {
  readonly customerAccountId: string | null;
  readonly contact?: { readonly email?: string | null } | null;
  readonly personalDataErasedAt?: Date | null;
}

export type CustomerMessage =
  | { readonly audience: 'customer'; readonly code: AccountMessageCode; readonly customerAccountId: string }
  | { readonly audience: 'guest'; readonly code: GuestMessageCode; readonly to: string };

/** The message for `accountCode` about `rc`, or `null` when nobody is to receive one. */
export function customerMessageFor(rc: MessageCase, accountCode: AccountMessageCode): CustomerMessage | null {
  if (rc.customerAccountId != null) {
    return { audience: 'customer', code: accountCode, customerAccountId: rc.customerAccountId };
  }
  if (rc.personalDataErasedAt) return null;
  const to = rc.contact?.email?.trim() ?? '';
  if (to === '') return null;
  return { audience: 'guest', code: GUEST_TWINS[accountCode], to };
}

/** `<base>/returns/track/<token>`, or `''` without a base — what every guest twin carries (FR-044). */
export function trackingUrlOf(base: string | null | undefined, token: string): string {
  const trimmed = (base ?? '').trim().replace(/\/+$/, '');
  return trimmed === '' ? '' : `${trimmed}/returns/track/${encodeURIComponent(token)}`;
}
