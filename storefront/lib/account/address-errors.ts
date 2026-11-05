import { defineUrlErrors } from '../url-errors';

/**
 * What `/addresses` and `/organization/addresses` say about a refused write
 * (issue #745). **A code travels, never a sentence** — see `lib/url-errors.ts`.
 *
 * `/addresses` redirects with `?error=<code>`. `/organization/addresses`
 * answers a refused create as action state ({@link AddressFormState}) — its
 * refusals are mostly `VALIDATION_FAILED`, and the fields at fault are the
 * detail worth keeping — and only its remove redirects.
 */
export const ADDRESS_ERRORS = defineUrlErrors({
  api: {
    VALIDATION_FAILED: 'account.addresses.error.VALIDATION_FAILED',
    NOT_FOUND: 'account.addresses.error.NOT_FOUND',
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

/** The address form's fields, by the name the form posts and the API's validation `path` names. */
export const ADDRESS_FIELDS = ['kind', 'recipientName', 'street', 'city', 'postalCode', 'country', 'phone'] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

/**
 * What the organization address form's server action answers through
 * `useActionState` when the API refuses the create: the refusal's code and the
 * fields at fault — nothing of what was typed (the client form keeps that) and
 * nothing of the API's sentence. A success redirects.
 */
export interface AddressFormState {
  readonly error: string | null;
  readonly fields: readonly AddressField[];
}

export const IDLE_ADDRESS_FORM: AddressFormState = { error: null, fields: [] };

function isAddressField(path: string): path is AddressField {
  return (ADDRESS_FIELDS as readonly string[]).includes(path);
}

/**
 * The fields a `VALIDATION_FAILED` refusal names, each once, in the form's order. Its `details`
 * is the envelope's `[{ path, issue }]`; only a `path` that is one of the form's fields counts,
 * and the `issue` — the validator's English sentence — is never read.
 */
export function invalidAddressFields(details: unknown): AddressField[] {
  if (!Array.isArray(details)) return [];
  const named = new Set<string>();
  for (const entry of details) {
    const path = entry !== null && typeof entry === 'object' ? (entry as { path?: unknown }).path : undefined;
    if (typeof path === 'string') named.add(path.replace(/^body\./, ''));
  }
  return ADDRESS_FIELDS.filter((field) => named.has(field) && isAddressField(field));
}
