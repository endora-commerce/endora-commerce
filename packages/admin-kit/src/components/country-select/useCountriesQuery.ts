// Shared loader for the dictionary country list.
//
// The active country set is small (~250 rows) and effectively static for
// the lifetime of a session, so we fetch it once per locale and memoise the
// in-flight promise at module scope. Multiple <CountrySelect /> instances on
// the same screen (e.g. delivery + billing address) therefore share a single
// network request instead of each firing their own.
//
// Reads the PUBLIC dictionary facade (`GET /api/v1/dictionary`), which is not
// gated behind the `dictionary.write` admin permission — so any admin who can
// reach a form (orders, customers, organizations…) can populate the dropdown
// regardless of their dictionary access.

import { useEffect, useState } from 'react';
import type { DictionaryRegistryResponse, ResolvedCountry } from '@endora-commerce/contracts';
import { apiClient } from '../../lib/api-client.js';

const cache = new Map<string, Promise<ResolvedCountry[]>>();

function load(locale: string): Promise<ResolvedCountry[]> {
  const cached = cache.get(locale);
  if (cached) return cached;
  const params = new URLSearchParams();
  if (locale) params.set('locale', locale);
  const query = params.toString();
  const promise = apiClient
    .get<DictionaryRegistryResponse>(`/api/v1/dictionary${query ? `?${query}` : ''}`)
    .then((res) => res.data.countries)
    .catch((err: unknown) => {
      // Don't poison the cache on a transient failure — let the next mount retry.
      cache.delete(locale);
      throw err;
    });
  cache.set(locale, promise);
  return promise;
}

export interface UseCountriesQueryResult {
  countries: ResolvedCountry[];
  loading: boolean;
  error: boolean;
}

/**
 * Returns the active dictionary countries (locale-resolved labels, sorted by
 * the dictionary `sortOrder`). Shared/memoised across instances per locale.
 */
export function useCountriesQuery(locale: string): UseCountriesQueryResult {
  const [countries, setCountries] = useState<ResolvedCountry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    void load(locale)
      .then((rows) => {
        if (!alive) return;
        setCountries(rows);
      })
      .catch(() => {
        if (!alive) return;
        setError(true);
        setCountries([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, [locale]);

  return { countries, loading, error };
}
