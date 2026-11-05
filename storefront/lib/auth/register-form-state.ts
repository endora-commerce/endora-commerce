import { registryLookupIdSchema } from '@endora-commerce/contracts';
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

export interface RegisterFormState {
  values: RegisterFormValues;
  lookup: RegisterLookupState | null;
  /** The backend's translated message for a refused registration. */
  error: null | { code: string; message: string };
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
  };
}

/**
 * A refused registration: every value but the password, the lookup the buyer
 * was shown, and the refusal. The reference the form posted is kept even when
 * the previous state lost it, so the retry still carries the snapshot (FR-017).
 */
export function refusedRegistration(
  previous: RegisterFormState,
  formData: FormData,
  error: { code: string; message: string },
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
  };
}
