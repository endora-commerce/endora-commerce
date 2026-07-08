import { apiGet, type RequestContext } from './client';

/**
 * Storefront dictionary bindings. The registry endpoint returns the active
 * countries / currencies / languages the platform accepts — used to populate
 * the checkout address country picker so only valid dictionary codes are
 * submitted (avoids DICTIONARY_ENTRY_NOT_FOUND on address creation).
 */
export interface StorefrontCountry {
  code: string;
  label: string;
}

interface RegistryResponse {
  data: {
    countries: Array<{ code: string; label: string }>;
  };
}

export async function listCountries(ctx: RequestContext = {}): Promise<StorefrontCountry[]> {
  const payload = await apiGet<RegistryResponse>('/api/v1/dictionary', ctx, { revalidate: 3600 });
  return payload.data.countries.map((c) => ({ code: c.code, label: c.label }));
}
