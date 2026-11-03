import {
  ERROR_CODES,
  type FormDefinitionIssue,
  type FormEntryStatus,
  type FormFieldErrorCode,
  type FormNotAcceptingReason,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The refusals of the Forms API (`specs/170-forms-module/` research R-25), one statement each, for
 * the service and the Commands alike. The sentence a reader sees is `errors.<CODE>` of this
 * module's bundle; the English message here is the fallback and the log line.
 *
 * Each factory is written by the change that adds its code's first raise site (standing rule 5).
 */

/** No such form — or a malformed id, which is answered the same. */
export function formNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.FORM_NOT_FOUND, 'Form not found.');
}

/** Another form already uses this key (keys are unique, R-4). */
export function formKeyTaken(key: string): HttpError {
  return new HttpError(409, ERROR_CODES.FORM_KEY_TAKEN, `Another form already uses the key "${key}".`, { key });
}

/** The form changed since the caller read it (R-26): its revision is not the one named. */
export function formRevisionConflict(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.FORM_REVISION_CONFLICT,
    'This form was changed by someone else. Reload it and make your change again.',
  );
}

/** A publish refused by the definition rules (FR-011, FR-033): each issue names its element. */
export function formDefinitionInvalid(issues: readonly FormDefinitionIssue[]): HttpError {
  return new HttpError(400, ERROR_CODES.FORM_DEFINITION_INVALID, 'This form cannot be published as it is.', {
    issues: issues.map((issue) => ({ ...issue })),
  });
}

/**
 * A form with entries is not deleted on the no-entries path (FR-013). `entryCount` is what the
 * caller may see; the confirmation path is User Story 4's (T079).
 */
export function formHasEntries(entryCount: number): HttpError {
  return new HttpError(409, ERROR_CODES.FORM_HAS_ENTRIES, 'This form has entries.', { entryCount });
}

/**
 * The form takes no submission now (FR-043, research R-12 step 3): `details.code` is the reason the
 * block and a headless client word for the shopper. A draft, a deleted form and an id that never
 * existed are all `unavailable`, so the refusal says no more than the public read does.
 */
export function formNotAccepting(reason: FormNotAcceptingReason): HttpError {
  return new HttpError(409, ERROR_CODES.FORM_NOT_ACCEPTING, 'This form is not accepting answers right now.', {
    code: reason,
  });
}

/** A submission body over the route's 256 KiB limit (FR-036, research R-15). */
export function formSubmissionTooLarge(): HttpError {
  return new HttpError(413, ERROR_CODES.FORM_SUBMISSION_TOO_LARGE, 'These answers are too long to send.');
}

/**
 * Answers the served version refuses (FR-034, research R-12 step 5): one `{ fieldKey, code, message }`
 * per broken field, the message in the submission language — the operator's override when the
 * version carries one, else the module's built-in sentence. Nothing was stored.
 */
export function formSubmissionInvalid(
  fields: readonly { fieldKey: string; code: FormFieldErrorCode; message: string }[],
): HttpError {
  return new HttpError(400, ERROR_CODES.FORM_SUBMISSION_INVALID, 'Some answers are not valid.', {
    fields: fields.map((field) => ({ ...field })),
  });
}

/**
 * No such entry (FR-046): a missing id, a malformed one and an entry outside the caller's
 * organisations — or an anonymous one, for a scoped administrator — all answer this, with the same
 * body, so a refusal never tells that an entry exists.
 */
export function formEntryNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.FORM_ENTRY_NOT_FOUND, 'Form entry not found.');
}

/** The entry left the status the caller named (R-16); `details.status` is where it is now. */
export function formEntryStatusConflict(status: FormEntryStatus): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.FORM_ENTRY_STATUS_CONFLICT,
    'This entry was changed by someone else. Reload it to see its status.',
    { status },
  );
}

/**
 * A write that removes entries of every organisation — deleting a form with entries, changing its
 * retention — by an administrator confined to some (research Principle XI review).
 */
export function formScopeRequired(): HttpError {
  return new HttpError(
    403,
    ERROR_CODES.FORM_SCOPE_REQUIRED,
    'Only an administrator who can see every organisation may do this.',
  );
}

/**
 * The CAPTCHA provider did not verify the submission, or none was sent (FR-042, research R-14).
 * Nothing about the provider's answer travels: its error codes are the provider's, not the shopper's.
 */
export function formCaptchaFailed(): HttpError {
  return new HttpError(400, ERROR_CODES.FORM_CAPTCHA_FAILED, 'The CAPTCHA check was not passed.');
}

/**
 * The CAPTCHA provider could not answer — a timeout, a network error, a non-2xx or a body that is
 * not its answer (research R-14, A-5): the submission is refused, never taken unchecked, and the
 * client is told to try again shortly.
 */
export function formCaptchaUnavailable(): HttpError {
  return new HttpError(
    503,
    ERROR_CODES.FORM_CAPTCHA_UNAVAILABLE,
    'The CAPTCHA provider could not be reached.',
    undefined,
    { 'Retry-After': '30' },
  );
}
