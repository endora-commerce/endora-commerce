import { defineUrlErrors } from '../url-errors';
import type { MessageKey } from '../i18n/messages';

/**
 * What the one address book (`components/account/AddressBook.tsx`) says about a
 * refused write, on `/addresses` and on `/organization/addresses` alike
 * (`specs/173-b2c-address-book-merge/`; issues #745 and #792).
 *
 * **A code travels, never a sentence** (`lib/url-errors.ts`). *Remove* and
 * *Make default* redirect with `?error=<code>`; a refused *add* answers as
 * action state ({@link AddressFormState}) so the form keeps what was typed, and
 * nothing of it travels in a URL.
 */
export const ADDRESS_ERRORS = defineUrlErrors({
  api: {
    VALIDATION_FAILED: 'account.addresses.error.VALIDATION_FAILED',
    NOT_FOUND: 'account.addresses.error.NOT_FOUND',
    DICTIONARY_ENTRY_INACTIVE: 'account.addresses.error.VALIDATION_FAILED',
    DICTIONARY_ENTRY_NOT_FOUND: 'account.addresses.error.VALIDATION_FAILED',
    ORGANIZATION_PERMISSION_REQUIRED: 'commerce.error.ORGANIZATION_PERMISSION_REQUIRED',
  },
  own: {
    SAVE_FAILED: 'account.addresses.saveFailed',
    REMOVE_FAILED: 'account.addresses.removeFailed',
    DEFAULT_FAILED: 'account.addresses.defaultFailed',
    FAILED: 'account.addresses.error.FAILED',
  },
  generic: 'FAILED',
});

/** The add form's fields, by the name the form posts and the API's validation `path` names. */
export const ADDRESS_FIELDS = ['kind', 'recipientName', 'street', 'city', 'postalCode', 'country', 'phone'] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

/**
 * Why one field was refused, as a code — never as the validator's sentence
 * (issue #792). `required` and `tooLong` come from the form's own parse of the
 * published schema; `countryUnavailable` and `countryUnknown` from the
 * `dictionaries` refusal the API answers for the country; `invalid` is
 * anything else, and still names its field.
 */
export const FIELD_ISSUES = ['required', 'tooLong', 'countryUnavailable', 'countryUnknown', 'invalid'] as const;
export type FieldIssue = (typeof FIELD_ISSUES)[number];

export interface FieldError {
  readonly field: AddressField;
  readonly issue: FieldIssue;
}

/**
 * What the add form's server action answers through `useActionState` when the
 * create is refused: the refusal's code and the fields at fault with why —
 * nothing of what was typed (the client form keeps that) and nothing of the
 * API's sentence. A success redirects.
 */
export interface AddressFormState {
  readonly error: string | null;
  readonly fields: readonly FieldError[];
}

export const IDLE_ADDRESS_FORM: AddressFormState = { error: null, fields: [] };

/**
 * The sentence for one field's issue: specific, and saying what to do
 * (`ux-laws` §174, §290). Every field has its own copy for every issue it can
 * meet, so no field falls back to a generic "check this field".
 */
const FIELD_MESSAGES: Readonly<Record<AddressField, Partial<Record<FieldIssue, MessageKey>> & { invalid: MessageKey }>> = {
  kind: { invalid: 'account.addresses.field.kind.invalid' },
  recipientName: {
    required: 'account.addresses.field.recipientName.required',
    tooLong: 'account.addresses.field.recipientName.tooLong',
    invalid: 'account.addresses.field.recipientName.invalid',
  },
  street: {
    required: 'account.addresses.field.street.required',
    tooLong: 'account.addresses.field.street.tooLong',
    invalid: 'account.addresses.field.street.invalid',
  },
  city: {
    required: 'account.addresses.field.city.required',
    tooLong: 'account.addresses.field.city.tooLong',
    invalid: 'account.addresses.field.city.invalid',
  },
  postalCode: {
    required: 'account.addresses.field.postalCode.required',
    tooLong: 'account.addresses.field.postalCode.tooLong',
    invalid: 'account.addresses.field.postalCode.invalid',
  },
  country: {
    required: 'account.addresses.field.country.required',
    countryUnavailable: 'account.addresses.field.country.unavailable',
    countryUnknown: 'account.addresses.field.country.unknown',
    invalid: 'account.addresses.field.country.unknown',
  },
  phone: {
    tooLong: 'account.addresses.field.phone.tooLong',
    invalid: 'account.addresses.field.phone.invalid',
  },
};

/** The sentence a field at fault reads — its own copy for the issue, or its own `invalid` copy. */
export function fieldErrorKey(error: FieldError): MessageKey {
  const messages = FIELD_MESSAGES[error.field];
  return messages[error.issue] ?? messages.invalid;
}

function isAddressField(path: string): path is AddressField {
  return (ADDRESS_FIELDS as readonly string[]).includes(path);
}

/** One entry per field, the first issue met, in the form's order. */
function byFormOrder(errors: readonly FieldError[]): FieldError[] {
  const first = new Map<AddressField, FieldError>();
  for (const error of errors) if (!first.has(error.field)) first.set(error.field, error);
  return ADDRESS_FIELDS.flatMap((field) => {
    const error = first.get(field);
    return error ? [error] : [];
  });
}

/**
 * A Zod issue, by the two members this reads: where it is and what kind it is.
 * The issue's `message` — the validator's English sentence — is never read.
 */
export interface ValidatorIssue {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly minimum?: unknown;
}

/** The fields the form's own parse of the published schema refuses, and why. */
export function fieldErrorsFromIssues(issues: readonly ValidatorIssue[]): FieldError[] {
  const errors: FieldError[] = [];
  for (const issue of issues) {
    const path = String(issue.path[0] ?? '');
    if (!isAddressField(path)) continue;
    errors.push({ field: path, issue: issueOf(issue) });
  }
  return byFormOrder(errors);
}

function issueOf(issue: ValidatorIssue): FieldIssue {
  if (issue.code === 'too_big') return 'tooLong';
  if (issue.code === 'too_small') return 'required';
  if (issue.code === 'invalid_type') return 'required';
  return 'invalid';
}

/** The API's codes for a country `dictionaries` refuses, as the field issue they are. */
const COUNTRY_REFUSALS: Readonly<Record<string, FieldIssue>> = {
  DICTIONARY_ENTRY_INACTIVE: 'countryUnavailable',
  DICTIONARY_ENTRY_NOT_FOUND: 'countryUnknown',
};

/**
 * The fields an API refusal names, and why. Its `details` is the envelope's
 * `[{ path, issue }]`; only a `path` that is one of the form's fields counts. The
 * `issue` is read only as a lookup key against the codes this file knows — a
 * country refusal carries its code there — and is never displayed: a validator
 * sentence matches no key and reads as the field's `invalid` copy.
 */
export function fieldErrorsFromApi(code: string, details: unknown): FieldError[] {
  if (!Array.isArray(details)) return [];
  const errors: FieldError[] = [];
  for (const entry of details) {
    if (entry === null || typeof entry !== 'object') continue;
    const { path, issue } = entry as { path?: unknown; issue?: unknown };
    if (typeof path !== 'string') continue;
    const field = path.replace(/^body\./, '');
    if (!isAddressField(field)) continue;
    const known = (typeof issue === 'string' ? COUNTRY_REFUSALS[issue] : undefined) ?? COUNTRY_REFUSALS[code];
    errors.push({ field, issue: field === 'country' && known ? known : 'invalid' });
  }
  return byFormOrder(errors);
}
