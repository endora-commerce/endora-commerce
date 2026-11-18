import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Issue #1447 (UX audit DS-14) — one record a detail screen shows, read with its
 * first load kept apart from every refresh after it.
 *
 * The screens this replaces set one `loading` flag on every read and returned a
 * bare "Loading…" while it was set, so each action that re-read the record
 * unmounted the page: the open tab, the scroll position and the focus went with
 * it, and the success notice landed at the top of a re-rendered page (SALES-06).
 * Here the first load is the only state with nothing to show; a refresh keeps
 * `data` on screen and only raises `refreshing`, which the screen spreads onto
 * its content as `aria-busy` (`busyProps`).
 *
 * - `key` names the record (its id). A new key is a new first load, and the
 *   previous record is never returned under it, not even for one render.
 * - `load` reads it. Answer `null` for a record that does not exist; a thrown
 *   error is a failed read, kept in `error`. It is read through a ref, so it may
 *   close over fresh state without restarting the first load.
 * - Only the latest read writes: an earlier, slower answer is dropped.
 */
export interface DetailResource<T> {
  /** The record, or `null` before the first load settles, when it is missing, or when it failed. */
  data: T | null;
  /** Writes an answer the screen already has (an action's response) without a re-read. */
  setData: Dispatch<SetStateAction<T | null>>;
  /** True until the first read for the current `key` settles: render a skeleton. */
  initialLoading: boolean;
  /** True while a re-read runs with `data` still on screen: keep the content, mark it busy. */
  refreshing: boolean;
  /** The latest read's failure, `null` after a read that succeeded. */
  error: unknown;
  /** Re-reads without blanking the page; resolves once the read settled. Never rejects. */
  refresh: () => Promise<void>;
  /** `{ 'aria-busy': true }` while refreshing, else nothing — spread on the content region. */
  busyProps: { 'aria-busy'?: true };
}

export function useDetailResource<T>(key: string, load: () => Promise<T | null>): DetailResource<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(key);
  keyRef.current = key;
  // Every read takes a ticket; only the newest one writes, and a key change or an
  // unmount invalidates whatever is still in flight.
  const ticket = useRef(0);

  const [state, setState] = useState<{ key: string | null; data: T | null; error: unknown }>({
    key: null,
    data: null,
    error: null,
  });
  const [refreshing, setRefreshing] = useState(false);

  const read = useCallback(async (): Promise<void> => {
    const mine = ++ticket.current;
    const readKey = keyRef.current;
    try {
      const data = await loadRef.current();
      if (mine !== ticket.current) return;
      setState({ key: readKey, data, error: null });
    } catch (err) {
      if (mine !== ticket.current) return;
      setState((prev) => ({ key: readKey, data: prev.key === readKey ? prev.data : null, error: err }));
    } finally {
      if (mine === ticket.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setRefreshing(false);
    void read();
    return () => {
      ticket.current += 1;
    };
  }, [key, read]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await read();
  }, [read]);

  const setData = useCallback<Dispatch<SetStateAction<T | null>>>((next) => {
    setState((prev) => ({
      ...prev,
      data: typeof next === 'function' ? (next as (p: T | null) => T | null)(prev.data) : next,
    }));
  }, []);

  const initialLoading = state.key !== key;
  const isRefreshing = refreshing && !initialLoading;
  return {
    data: initialLoading ? null : state.data,
    setData,
    initialLoading,
    refreshing: isRefreshing,
    error: initialLoading ? null : state.error,
    refresh,
    busyProps: isRefreshing ? { 'aria-busy': true } : {},
  };
}
