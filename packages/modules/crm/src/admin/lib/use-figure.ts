import { useCallback, useEffect, useRef, useState } from 'react';

export interface Figure<T> {
  /** The last answer; kept on screen while a newer one is on its way. */
  data: T | null;
  loading: boolean;
  /** The failure of the last read, as it should be said. */
  error: unknown;
  reload: () => void;
}

/**
 * One read of the analytics screen: asked again whenever `load` changes, never
 * answered by a slower, earlier request, and able to be asked again by hand.
 * `load === null` means "do not ask" — the range on screen is not a range.
 */
export function useFigure<T>(load: (() => Promise<T>) | null): Figure<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(load !== null);
  const [error, setError] = useState<unknown>(null);
  const sequence = useRef(0);

  const run = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    if (load === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const answer = await load();
      if (current === sequence.current) setData(answer);
    } catch (failure) {
      if (current === sequence.current) setError(failure ?? new Error('unknown'));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, loading, error, reload: (): void => void run() };
}
