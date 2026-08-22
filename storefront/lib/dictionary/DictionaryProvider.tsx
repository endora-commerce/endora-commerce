'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { DictionaryEntryType } from '@endora-commerce/contracts';
import {
  fetchByCodeFromBrowser,
  fetchDictionaryFromBrowser,
  type DictionaryByCode,
  type DictionaryRegistry,
} from './client';

export interface DictionaryContextValue extends DictionaryRegistry {
  locale?: string | undefined;
  channel?: string | undefined;
  loading: boolean;
  resolveByCode(type: DictionaryEntryType, code: string): Promise<DictionaryByCode | null>;
}

const DictionaryContext = createContext<DictionaryContextValue | null>(null);

export function DictionaryProvider(props: {
  initialDictionary: DictionaryRegistry;
  locale?: string | undefined;
  channel?: string | undefined;
  children: ReactNode;
}): ReactNode {
  const [dictionary, setDictionary] = useState(props.initialDictionary);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchDictionaryFromBrowser({
      ...(props.locale !== undefined ? { locale: props.locale } : {}),
      ...(props.channel !== undefined ? { channel: props.channel } : {}),
    })
      .then((next) => {
        if (!cancelled) setDictionary(next);
      })
      .catch(() => {
        /* Keep SSR data if client revalidation fails. */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.locale, props.channel]);

  const resolveByCode = useCallback(
    async (type: DictionaryEntryType, code: string): Promise<DictionaryByCode | null> => {
      try {
        return await fetchByCodeFromBrowser({
          type,
          code,
          ...(props.locale !== undefined ? { locale: props.locale } : {}),
        });
      } catch {
        return null;
      }
    },
    [props.locale],
  );

  const value = useMemo<DictionaryContextValue>(
    () => ({
      ...dictionary,
      locale: props.locale,
      channel: props.channel,
      loading,
      resolveByCode,
    }),
    [dictionary, loading, props.channel, props.locale, resolveByCode],
  );

  return <DictionaryContext.Provider value={value}>{props.children}</DictionaryContext.Provider>;
}

export function useDictionary(): DictionaryContextValue {
  const value = useContext(DictionaryContext);
  if (!value) {
    throw new Error('useDictionary must be used under DictionaryProvider.');
  }
  return value;
}
