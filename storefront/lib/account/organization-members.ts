import type { MessageKey } from '../i18n/messages';

/**
 * What travels from `/organization/members`' server actions back to the page,
 * and what the page says about it (issue #740). Pure, so the page and the
 * actions share one vocabulary.
 *
 * **A code travels, never a sentence** — the rule of
 * `lib/account/organization-roles.ts` and `lib/account/org-cart-approval.ts`:
 * an action answers with a redirect, so whatever it reports is in the URL, and
 * a sentence there is text anyone can put on an administrator's page with a
 * crafted link. The page names a code it knows in its own language and reads
 * anything else as {@link FAILED}. For the same reason the invitation notice
 * names no e-mail address: it would have to come from the URL too.
 *
 * The API's codes are the ones the member and invitation routes answer
 * (`packages/modules/organizations/src/backend/routes.members.ts`); the
 * `*_FAILED` ones are the storefront's own, each action's answer to a refusal
 * the page cannot name or to a request that never reached the API.
 */

const FAILED = 'FAILED';

const ERROR_KEYS = {
  EMAIL_ALREADY_IN_ORGANIZATION: 'account.members.error.EMAIL_ALREADY_IN_ORGANIZATION',
  EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION: 'account.members.error.EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION',
  CANNOT_DEMOTE_LAST_ADMIN: 'account.members.error.CANNOT_DEMOTE_LAST_ADMIN',
  CANNOT_REMOVE_LAST_ADMIN: 'account.members.error.CANNOT_REMOVE_LAST_ADMIN',
  CANNOT_REVOKE_LAST_ADMIN_INVITE: 'account.members.error.CANNOT_REVOKE_LAST_ADMIN_INVITE',
  NOT_FOUND: 'account.members.error.NOT_FOUND',
  FORBIDDEN: 'account.members.adminRequired',
  VALIDATION_FAILED: 'account.members.error.VALIDATION_FAILED',
  INVITE_FAILED: 'account.members.inviteFailed',
  ROLE_FAILED: 'account.members.roleFailed',
  REMOVE_FAILED: 'account.members.removeFailed',
  REVOKE_FAILED: 'account.members.revokeFailed',
  [FAILED]: 'account.members.error.FAILED',
} as const satisfies Record<string, MessageKey>;

export type MemberErrorCode = keyof typeof ERROR_KEYS;

/** Each action's own failure code. */
export type MemberActionFailure = 'INVITE_FAILED' | 'ROLE_FAILED' | 'REMOVE_FAILED' | 'REVOKE_FAILED';

/** The storefront's own codes — an API answer naming one of them is not taken at its word. */
const STOREFRONT_CODES: ReadonlySet<string> = new Set<MemberErrorCode>([
  'INVITE_FAILED',
  'ROLE_FAILED',
  'REMOVE_FAILED',
  'REVOKE_FAILED',
  FAILED,
]);

/** Whether `code` is one the members page can name. */
export function isMemberErrorCode(code: string): code is MemberErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_KEYS, code);
}

/**
 * The code a failed action reports: the API's own when the page can name it,
 * the action's own failure otherwise — `apiCode` is `null` when the request
 * never had an API answer.
 */
export function memberFailureCode(apiCode: string | null, fallback: MemberActionFailure): MemberErrorCode {
  return apiCode !== null && isMemberErrorCode(apiCode) && !STOREFRONT_CODES.has(apiCode) ? apiCode : fallback;
}

/** The sentence for `?error=<code>`, or `null` when there is no error parameter. */
export function memberErrorKey(code: string | undefined): MessageKey | null {
  if (code === undefined || code === '') return null;
  return ERROR_KEYS[isMemberErrorCode(code) ? code : FAILED];
}

/** The sentence for `?status=invited|revoked`, or `null`. */
export function memberStatusKey(status: string | undefined): MessageKey | null {
  if (status === 'invited') return 'account.members.invited';
  if (status === 'revoked') return 'account.members.revoked';
  return null;
}
