import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * Issue #89 — `useCountriesQuery` has a test.
 *
 * The hook reads the public dictionary facade (`GET /api/v1/dictionary`) and
 * memoises the in-flight request per locale **at module scope**, so every
 * `<CountrySelect>` on a screen shares one request. That cache outlives a test,
 * which is why each test below asks for a locale no other test uses: reusing one
 * would read the previous test's answer and assert nothing about this one.
 *
 * The mock keys on `@endora-commerce/admin-kit/lib`, the barrel the hook
 * imports `apiClient` from; `admin/test/setup.ts` makes `fetch` throw, so a hook
 * that bypassed the barrel would report a failure on every test here.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { useCountriesQuery } = await import('@endora-commerce/admin-kit/components');

afterEach(() => {
  getSpy.mockReset();
});

const POLAND = { code: 'PL', label: 'Polska', sortOrder: 1 };
const GERMANY = { code: 'DE', label: 'Niemcy', sortOrder: 2 };

function registry(countries: unknown[]): unknown {
  return { data: { countries } };
}

describe('useCountriesQuery', () => {
  it('starts loading, with no countries and no error', () => {
    getSpy.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useCountriesQuery('loading-xx'));

    expect(result.current).toEqual({ countries: [], loading: true, error: false });
    expect(getSpy).toHaveBeenCalledWith('/api/v1/dictionary?locale=loading-xx');
  });

  it('settles on an empty list when the dictionary has no active countries', async () => {
    getSpy.mockResolvedValue(registry([]));
    const { result } = renderHook(() => useCountriesQuery('empty-xx'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ countries: [], loading: false, error: false });
  });

  it('returns the countries in the order the dictionary gives them', async () => {
    getSpy.mockResolvedValue(registry([POLAND, GERMANY]));
    const { result } = renderHook(() => useCountriesQuery('pl-PL'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ countries: [POLAND, GERMANY], loading: false, error: false });
  });

  it('asks without a locale parameter when the locale is empty', async () => {
    getSpy.mockResolvedValue(registry([POLAND]));
    const { result } = renderHook(() => useCountriesQuery(''));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getSpy).toHaveBeenCalledWith('/api/v1/dictionary');
  });

  it('shares one request between every consumer of the same locale', async () => {
    getSpy.mockResolvedValue(registry([GERMANY]));
    const first = renderHook(() => useCountriesQuery('shared-xx'));
    const second = renderHook(() => useCountriesQuery('shared-xx'));

    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(first.result.current.countries).toEqual([GERMANY]);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('reports a failed request, and does not cache the failure', async () => {
    getSpy.mockRejectedValueOnce(new Error('dictionary down'));
    const failed = renderHook(() => useCountriesQuery('failing-xx'));

    await waitFor(() => expect(failed.result.current.loading).toBe(false));
    expect(failed.result.current).toEqual({ countries: [], loading: false, error: true });
    failed.unmount();

    // The next mount retries instead of replaying the rejected promise.
    getSpy.mockResolvedValueOnce(registry([POLAND]));
    const retried = renderHook(() => useCountriesQuery('failing-xx'));
    await waitFor(() => expect(retried.result.current.loading).toBe(false));
    expect(retried.result.current).toEqual({ countries: [POLAND], loading: false, error: false });
    expect(getSpy).toHaveBeenCalledTimes(2);
  });
});
