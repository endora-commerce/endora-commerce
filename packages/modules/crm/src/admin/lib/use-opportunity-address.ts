import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AdminListViewMode } from '@endora-commerce/contracts';
import { readOpportunityView, withOpportunityView } from './opportunity-address.js';

const SEARCH_DEBOUNCE_MS = 300;

export interface OpportunityAddress {
  /** The address's query, as text — stable until it changes. */
  address: string;
  /** The same query, parsed once per change. */
  params: URLSearchParams;
  /** The view the address asks for. */
  view: AdminListViewMode;
  /**
   * Rewrite the address from the address as it stands now. A filter change
   * replaces the history entry; `push` adds one (a change of view, so Back
   * returns to the other view).
   */
  update: (next: (previous: URLSearchParams) => URLSearchParams, options?: { push?: boolean }) => void;
  /** Switch view, every filter kept. */
  setView: (view: AdminListViewMode) => void;
}

/**
 * The Opportunities page's address, shared by its two views (issue #1558).
 *
 * Each change starts from the address as this screen last knew it — what it
 * last wrote itself, or what it last rendered. react-router hands
 * `setSearchParams(fn)` the address of the last render, so two changes made in
 * one turn (two filter boxes whose typing pause ends together) would each start
 * from that one, and the second would write over the first (issue #418).
 */
export function useOpportunityAddress(): OpportunityAddress {
  const [searchParams, setSearchParams] = useSearchParams();
  const address = searchParams.toString();
  const params = useMemo(() => new URLSearchParams(address), [address]);
  const latest = useRef(address);
  useLayoutEffect(() => {
    latest.current = address;
  }, [address]);

  const update = useCallback<OpportunityAddress['update']>(
    (next, options) => {
      const written = next(new URLSearchParams(latest.current));
      latest.current = written.toString();
      setSearchParams(written, { replace: options?.push !== true });
    },
    [setSearchParams],
  );

  const setView = useCallback(
    (view: AdminListViewMode): void => update((previous) => withOpportunityView(previous, view), { push: true }),
    [update],
  );

  return { address, params, view: readOpportunityView(params), update, setView };
}

/**
 * The search box of a view whose search lives in the address: typed into
 * freely, written to the address once typing pauses — and, the other way, an
 * address whose search this screen did not write (a link, the browser's Back,
 * *Clear all filters* on the other view) is what the box shows. One it did write is left alone:
 * more may have been typed since.
 */
export function useAddressSearch(
  committed: string,
  commit: (q: string) => void,
): readonly [string, (value: string) => void, () => void] {
  const [search, setSearch] = useState(committed);
  /** The search this screen last put in the address itself. */
  const written = useRef(committed);

  useEffect(() => {
    const typed = search.trim();
    if (typed === committed) return undefined;
    const timer = setTimeout(() => {
      written.current = typed;
      commit(typed);
    }, SEARCH_DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [search, committed, commit]);

  useEffect(() => {
    if (committed === written.current) return;
    written.current = committed;
    setSearch(committed);
  }, [committed]);

  /** Empty the box before *Clear all filters* empties the address, so nothing typed is written back. */
  const reset = useCallback((): void => {
    written.current = '';
    setSearch('');
  }, []);

  return [search, setSearch, reset] as const;
}
