import { registryLookupIdSchema, type InputSurfaceField } from '@endora-commerce/contracts';
import type { RegistrationCustomFields } from '../api/custom-field-input';
import type { LookupCompanyOutcome } from '../api/registry-lookup';

/**
 * Feature 173 — the business registration form's state and its pure helpers
 * (`specs/173-registration-registry-lookup/contracts/storefront-ux.md` §2,
 * research R-10).
 *
 * The form is one client component on `useActionState`, so a lookup and a
 * refused registration come back as **state**, never as a URL: nothing typed
 * appears in the address bar or the history (the owner's PR #715 ruling), and
 * a crafted link cannot pre-fill a registration. **The password never enters
 * this state** — `valuesFromFormData` does not read it — so the page that
 * comes back without JavaScript asks for it again and never renders it.
 */

export interface RegisterFormValues {
  organizationName: string;
  taxId: string;
  country: string;
  street: string;
  postalCode: string;
  city: string;
  firstName: string;
  lastName: string;
  email: string;
  // never: password
}

export type RegisterLookupStatus =
  | 'found'
  | 'not_found'
  | 'unavailable'
  | 'invalid_tax_id'
  | 'unsupported_country'
  | 'rate_limited';

export interface RegisterLookupState {
  status: RegisterLookupStatus;
  /** The reference registration sends back; `null` when the lookup minted none. */
  lookupId: string | null;
  source: 'gus' | 'mf' | 'vies' | null;
  vatStatus: 'active' | 'exempt' | 'not_registered' | 'unknown' | null;
  activityStatus: 'active' | 'ceased' | 'unknown' | null;
  /** True when the registry supplied no name and no address (VIES `---`). */
  noDetails: boolean;
}

/**
 * Feature 175 — one custom field as the buyer typed it: the text of a text,
 * number, date or single-choice field, the ticked options of a multiselect, the
 * state of a checkbox. Never converted: it is what the form is re-seeded with.
 */
export type RegisterCustomFieldValue = string | string[] | boolean;

/** The custom fields as typed, per group, keyed by definition key. */
export interface RegisterCustomFieldGroups {
  organization: Record<string, RegisterCustomFieldValue>;
  customer: Record<string, RegisterCustomFieldValue>;
}

/** One refused custom field, as the backend named it. */
export interface RegisterFieldError {
  code: string;
  /** The backend's sentence — said only for a code the storefront has no words for. */
  message: string;
}

export interface RegisterFormState {
  values: RegisterFormValues;
  lookup: RegisterLookupState | null;
  /** The backend's translated message for a refused registration. */
  error: null | { code: string; message: string };
  /**
   * Feature 175 — the custom fields as typed, kept across a refusal and a
   * lookup posted without JavaScript. Absent before the first answer.
   */
  customFields?: RegisterCustomFieldGroups;
  /**
   * Feature 175 — a refused registration's custom-field refusals, keyed as the
   * backend names them: `organization.<key>` / `firstUser.<key>`, or the group
   * alone (`organization`, `firstUser`) for a refusal of the whole group.
   */
  fieldErrors?: Record<string, RegisterFieldError>;
}

export const EMPTY_REGISTER_VALUES: RegisterFormValues = {
  organizationName: '',
  taxId: '',
  country: 'PL',
  street: '',
  postalCode: '',
  city: '',
  firstName: '',
  lastName: '',
  email: '',
};

export const INITIAL_REGISTER_FORM_STATE: RegisterFormState = {
  values: EMPTY_REGISTER_VALUES,
  lookup: null,
  error: null,
};

/** The company fields a lookup can fill. */
export type RegisterCompanyField = 'organizationName' | 'street' | 'postalCode' | 'city';

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** Every field the buyer typed, **except the password**. */
export function valuesFromFormData(formData: FormData): RegisterFormValues {
  const country = text(formData, 'country').trim().toUpperCase();
  return {
    organizationName: text(formData, 'organizationName'),
    taxId: text(formData, 'taxId'),
    country: country === '' ? 'PL' : country,
    street: text(formData, 'street'),
    postalCode: text(formData, 'postalCode'),
    city: text(formData, 'city'),
    firstName: text(formData, 'firstName'),
    lastName: text(formData, 'lastName'),
    email: text(formData, 'email'),
  };
}

/** The hidden `registryLookupId`, when it is a well-formed reference. */
export function lookupIdFromFormData(formData: FormData): string | undefined {
  const value = text(formData, 'registryLookupId');
  return registryLookupIdSchema.safeParse(value).success ? value : undefined;
}

/** What the status region says about one lookup outcome. */
export function lookupStateOf(outcome: LookupCompanyOutcome): RegisterLookupState {
  if (outcome.kind !== 'answer') {
    return { status: outcome.kind, lookupId: null, source: null, vatStatus: null, activityStatus: null, noDetails: false };
  }
  const { data } = outcome;
  const company = data.company;
  const address = company?.registeredAddress;
  return {
    status: data.status,
    lookupId: data.lookupId,
    source: data.status === 'found' ? data.source : null,
    vatStatus: company?.vatStatus ?? null,
    activityStatus: company?.activityStatus ?? null,
    noDetails:
      data.status === 'found' &&
      !company?.legalName &&
      !address?.street &&
      !address?.postalCode &&
      !address?.city,
  };
}

/**
 * The company values a found answer supplies. A field the registry left empty
 * is not returned, so whatever the buyer typed there stays (an empty field
 * beats an invented one, FR-005); the country follows the answer.
 */
export function companyValuesOf(outcome: LookupCompanyOutcome): Partial<RegisterFormValues> | null {
  if (outcome.kind !== 'answer' || outcome.data.status !== 'found' || !outcome.data.company) return null;
  const { company, country } = outcome.data;
  const address = company.registeredAddress;
  return {
    country,
    ...(company.legalName ? { organizationName: company.legalName } : {}),
    ...(address.street ? { street: address.street } : {}),
    ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    ...(address.city ? { city: address.city } : {}),
  };
}

/** A lookup's outcome applied to the form: values filled when found, every other value kept. */
export function applyLookupOutcome(state: RegisterFormState, outcome: LookupCompanyOutcome): RegisterFormState {
  return {
    values: { ...state.values, ...(companyValuesOf(outcome) ?? {}) },
    lookup: lookupStateOf(outcome),
    error: null,
    // Feature 175 — the custom fields typed before a lookup posted without JavaScript.
    ...(state.customFields ? { customFields: state.customFields } : {}),
  };
}

/**
 * A refused registration: every value but the password, the lookup the buyer
 * was shown, and the refusal. The reference the form posted is kept even when
 * the previous state lost it, so the retry still carries the snapshot (FR-017).
 * Feature 175 — the custom fields as typed and their refusals, when given.
 */
export function refusedRegistration(
  previous: RegisterFormState,
  formData: FormData,
  error: { code: string; message: string },
  custom: { customFields?: RegisterCustomFieldGroups; fieldErrors?: Record<string, RegisterFieldError> } = {},
): RegisterFormState {
  const postedLookupId = lookupIdFromFormData(formData) ?? null;
  const lookup: RegisterLookupState | null =
    previous.lookup ??
    (postedLookupId
      ? // Only the reference survived: kept for the retry, with nothing to announce
        // (a found state with no source renders no message).
        { status: 'found', lookupId: postedLookupId, source: null, vatStatus: null, activityStatus: null, noDetails: false }
      : null);
  return {
    values: valuesFromFormData(formData),
    lookup: lookup && postedLookupId && lookup.lookupId !== postedLookupId ? { ...lookup, lookupId: postedLookupId } : lookup,
    error,
    ...(custom.customFields ? { customFields: custom.customFields } : {}),
    ...(custom.fieldErrors && Object.keys(custom.fieldErrors).length > 0 ? { fieldErrors: custom.fieldErrors } : {}),
  };
}

// ---------------------------------------------------------------------------
// Feature 175 — custom fields open on `organization.register`
// (`specs/175-buyer-input-custom-fields/` research R-10, FR-031 – FR-033)
// ---------------------------------------------------------------------------

/** The form-field name of one custom field: `cf.organization.<key>` / `cf.customer.<key>`. */
export function customFieldName(group: keyof RegisterCustomFieldGroups, key: string): string {
  return `cf.${group}.${key}`;
}

/** One field as typed — the value the form is re-seeded with. */
function typedValue(formData: FormData, name: string, field: InputSurfaceField): RegisterCustomFieldValue {
  const all = formData.getAll(name).filter((v): v is string => typeof v === 'string');
  switch (field.valueType) {
    case 'boolean':
      // The hidden `false` comes first, the checkbox's `true` after it when ticked.
      return all.at(-1) === 'true';
    case 'multiselect':
      return all.filter((v) => v !== '');
    default:
      return all.at(-1) ?? '';
  }
}

/**
 * One field as the request carries it, or `undefined` for one left empty — a
 * whitespace-only answer is empty, as the backend reads it. An unticked
 * checkbox is `false`, never absent (spec edge case). A number is sent as one
 * when it reads as one (a decimal comma accepted); otherwise as typed, for the
 * backend to refuse beside the field.
 */
function requestValue(value: RegisterCustomFieldValue, field: InputSurfaceField): unknown {
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length > 0 ? value : undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (field.valueType === 'number') {
    const number = Number(trimmed.replace(',', '.'));
    return Number.isFinite(number) ? number : trimmed;
  }
  return trimmed;
}

/**
 * The custom fields of one posted form, read against the fields the form was
 * rendered with: `typed` re-seeds the form, `request` is each group's
 * `customFieldValues` — a group with nothing to send is absent, so a form with
 * no open field sends the request it always sent.
 */
export function customFieldsFromFormData(
  formData: FormData,
  fields: RegistrationCustomFields,
): {
  typed: RegisterCustomFieldGroups;
  request: { organization?: Record<string, unknown>; customer?: Record<string, unknown> };
} {
  const typed: RegisterCustomFieldGroups = { organization: {}, customer: {} };
  const request: { organization?: Record<string, unknown>; customer?: Record<string, unknown> } = {};
  for (const group of ['organization', 'customer'] as const) {
    const bag: Record<string, unknown> = {};
    for (const field of fields[group]) {
      const value = typedValue(formData, customFieldName(group, field.key), field);
      typed[group][field.key] = value;
      const sent = requestValue(value, field);
      if (sent !== undefined) bag[field.key] = sent;
    }
    if (Object.keys(bag).length > 0) request[group] = bag;
  }
  return { typed, request };
}

/**
 * The per-field refusals of a `422 CUSTOM_FIELD_VALUE_INVALID` envelope's
 * `details` (`{ field, code, message }`), keyed by `field`. Anything else in
 * the array is ignored.
 */
export function customFieldErrorsOf(details: unknown): Record<string, RegisterFieldError> {
  if (!Array.isArray(details)) return {};
  const out: Record<string, RegisterFieldError> = {};
  for (const entry of details as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const { field, code, message } = entry as Record<string, unknown>;
    if (typeof field === 'string' && typeof code === 'string') {
      out[field] = { code, message: typeof message === 'string' ? message : '' };
    }
  }
  return out;
}
