import {
  registrationOptionsResponseSchema,
  registryLookupResponseSchema,
  type RegistryLookupResult,
} from '@endora-commerce/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';
import { apiMutate } from './mutations';

/**
 * Feature 173 — the storefront's two calls to the registration company lookup
 * (`specs/173-registration-registry-lookup/contracts/public-api.md` §1–§2,
 * `contracts/storefront-ux.md`).
 *
 * - **The options read** says whether the lookup is on and for which
 *   countries. Platform-wide and anonymous, so it is cached in the Data Cache
 *   under {@link REGISTRATION_OPTIONS_TAG}, which the backend revalidates when
 *   the switch changes, with a 300 s ceiling for a lost revalidation. It
 *   **fails closed**: any error is "off", which costs the buyer nothing they
 *   cannot already do — the manual form (the `getFederatedSignInProviders`
 *   precedent).
 * - **The lookup** forwards the buyer's address, so the backend's per-client
 *   limit counts the buyer rather than the storefront (the `forms` precedent).
 *   It never throws: every answer is one outcome the form words.
 */

export const REGISTRATION_OPTIONS_TAG = 'organizations:registration-options';

export interface RegistrationOptions {
  enabled: boolean;
  /** Picker form (`GR`, not `EL`). */
  countries: string[];
}

const DISABLED: RegistrationOptions = { enabled: false, countries: [] };

export async function getRegistrationOptions(ctx: RequestContext = {}): Promise<RegistrationOptions> {
  try {
    const response = await apiGet<unknown>('/api/v1/organizations/registration-options', ctx, {
      revalidate: 300,
      tags: [REGISTRATION_OPTIONS_TAG],
    });
    const parsed = registrationOptionsResponseSchema.safeParse(response);
    if (!parsed.success) return DISABLED;
    const { enabled, countries } = parsed.data.data.registryLookup;
    return enabled ? { enabled, countries } : DISABLED;
  } catch {
    return DISABLED;
  }
}

export type LookupCompanyOutcome =
  | { kind: 'answer'; data: RegistryLookupResult }
  /** `429 RATE_LIMITED` — the buyer looked up too often. */
  | { kind: 'rate_limited' }
  /** Anything else: the switch went off meanwhile (404), the backend failed, an unreadable answer. */
  | { kind: 'unavailable' };

export async function lookupCompany(input: {
  taxId: string;
  country: string;
  forwardedFor?: string | null;
  ctx?: RequestContext;
}): Promise<LookupCompanyOutcome> {
  try {
    const result = await apiMutate<RegistryLookupResult>({
      method: 'POST',
      path: '/api/v1/organizations/registry-lookup',
      body: { taxId: input.taxId, country: input.country },
      ...(input.ctx ? { ctx: input.ctx } : {}),
      ...(input.forwardedFor ? { headers: { 'x-forwarded-for': input.forwardedFor } } : {}),
    });
    const parsed = registryLookupResponseSchema.safeParse({ data: result.data });
    return parsed.success ? { kind: 'answer', data: parsed.data.data } : { kind: 'unavailable' };
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 429) return { kind: 'rate_limited' };
    return { kind: 'unavailable' };
  }
}
