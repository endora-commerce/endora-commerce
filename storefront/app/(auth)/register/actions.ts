'use server';

import { headers } from 'next/headers';
import { registerOrganization } from '../../../lib/api/auth';
import { StorefrontApiError } from '../../../lib/api/client';
import { lookupCompany, type LookupCompanyOutcome } from '../../../lib/api/registry-lookup';
import {
  applyLookupOutcome,
  companyValuesOf,
  lookupIdFromFormData,
  lookupStateOf,
  refusedRegistration,
  valuesFromFormData,
  type RegisterFormState,
  type RegisterFormValues,
  type RegisterLookupState,
} from '../../../lib/auth/register-form-state';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { tForLocale } from '../../../lib/i18n/messages';
import { getServerContext } from '../../../lib/server-context';

/**
 * Feature 173 — the business registration form's server actions
 * (`specs/173-registration-registry-lookup/contracts/storefront-ux.md` §3,
 * research R-10).
 *
 * `registerFormAction` is the form's one `useActionState` action and dispatches
 * on the submitter's `intent`. Without JavaScript the browser posts the form to
 * it and Next renders the page with the returned state, so a lookup comes back
 * pre-filled and a refusal comes back with everything typed — except the
 * password, which never enters the state — and nothing in the URL (the owner's
 * PR #715 ruling). A refusal used to redirect with `?error=<message>`.
 *
 * `lookupCompanyAction` is the same lookup for the JavaScript path, which fills
 * the fields in place without submitting the form.
 */

/** The buyer's address as the request reached the storefront, for the backend's per-client limit. */
async function forwardedFor(): Promise<string | null> {
  return (await headers()).get('x-forwarded-for');
}

/** An empty tax ID is answered here: there is nothing to ask a registry about. */
async function lookupOrEmpty(values: Pick<RegisterFormValues, 'taxId' | 'country'>): Promise<LookupCompanyOutcome> {
  if (values.taxId.trim() === '') {
    return {
      kind: 'answer',
      data: {
        status: 'invalid_tax_id',
        lookupId: null,
        normalizedTaxId: null,
        country: values.country,
        source: null,
        company: null,
        fetchedAt: null,
      },
    };
  }
  return await lookupCompany({ taxId: values.taxId, country: values.country, forwardedFor: await forwardedFor() });
}

export async function registerFormAction(previous: RegisterFormState, formData: FormData): Promise<RegisterFormState> {
  const values = valuesFromFormData(formData);
  if (formData.get('intent') === 'lookup') {
    return applyLookupOutcome({ ...previous, values }, await lookupOrEmpty(values));
  }

  const registryLookupId = lookupIdFromFormData(formData);
  try {
    await registerOrganization({
      organization: {
        name: values.organizationName,
        taxId: values.taxId,
        registeredAddress: {
          street: values.street,
          city: values.city,
          postalCode: values.postalCode,
          country: values.country,
        },
      },
      firstUser: {
        email: values.email,
        password: (formData.get('password') as string | null) ?? '',
        firstName: values.firstName,
        lastName: values.lastName,
      },
      acceptedTermsVersion: (formData.get('acceptedTermsVersion') as string | null) ?? '2025-01',
      ...(registryLookupId ? { registryLookupId } : {}),
    });
  } catch (err) {
    if (err instanceof StorefrontApiError) {
      return refusedRegistration(previous, formData, { code: err.code, message: err.detail });
    }
    const t = tForLocale((await getServerContext()).locale);
    return refusedRegistration(previous, formData, { code: 'INTERNAL', message: t('auth.register.failed') });
  }
  return await localeRedirect(`/register?status=pending&email=${encodeURIComponent(values.email)}`);
}

export async function lookupCompanyAction(input: {
  taxId: string;
  country: string;
}): Promise<{ lookup: RegisterLookupState; company: Partial<RegisterFormValues> | null }> {
  const outcome = await lookupOrEmpty({
    taxId: String(input.taxId ?? ''),
    country: String(input.country ?? '').trim().toUpperCase() || 'PL',
  });
  return { lookup: lookupStateOf(outcome), company: companyValuesOf(outcome) };
}
