// React Context provider for the Admin UI i18n runtime — feature 019.
//
// Holds the current language and the merged bundle for that language.
// Re-renders the entire tree without sign-out when the language flips
// (FR-005, SC-002). Boot-time fetch is on-demand: the provider issues
// a single `getBundles(language)` call when its `language` prop changes
// and caches the response in state.
//
// Missing translations log a `console.warn` in development only
// (research §R8); production stays silent.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Bundle,
  GetBundlesResponse,
  SupportedAdminLanguage,
} from './types.js';
import { getBundles } from './language-storage.js';
import { resolve } from './resolver.js';

export interface TranslationProviderProps {
  /** Current language; flips when the user changes their preference. */
  language: SupportedAdminLanguage;
  /**
   * Optional pre-supplied bundle. When provided the provider skips its
   * boot fetch and uses this value (used by interaction tests and by
   * the pre-auth login screen which has no auth to call the endpoint).
   */
  initialBundle?: Bundle;
  /** Optional pre-supplied EN bundle for cross-language fallback (FR-013). */
  initialFallbackBundle?: Bundle;
  children: ReactNode;
}

interface TranslationContextValue {
  language: SupportedAdminLanguage;
  bundle: Bundle;
  fallbackBundle: Bundle | undefined;
  /** Translate a key under a module-scoped namespace (defaults to `core`). */
  t(scope: string, key: string, params?: Record<string, string | number>): string;
}

const TranslationContext = createContext<TranslationContextValue | null>(null);

export function TranslationProvider(props: TranslationProviderProps): ReactNode {
  const { language, initialBundle, initialFallbackBundle, children } = props;
  const [bundle, setBundle] = useState<Bundle>(initialBundle ?? {});
  const [fallbackBundle, setFallbackBundle] = useState<Bundle | undefined>(
    initialFallbackBundle,
  );
  const lastFetchedRef = useRef<SupportedAdminLanguage | null>(
    initialBundle ? language : null,
  );

  // Fetch the requested-language bundle whenever the language prop flips
  // (or on first mount when no initialBundle was supplied).
  useEffect(() => {
    if (lastFetchedRef.current === language) return;
    let cancelled = false;
    void (async () => {
      try {
        const res: GetBundlesResponse = await getBundles(language);
        if (cancelled) return;
        setBundle(res.bundles);
        lastFetchedRef.current = language;
        // Pre-fetch EN once for cross-language fallback (FR-013) — only
        // when the user has chosen a non-English language and we don't
        // already have it.
        if (language !== 'en' && !fallbackBundle) {
          const fb = await getBundles('en');
          if (!cancelled) setFallbackBundle(fb.bundles);
        }
      } catch (err) {
        // Logging only; the provider keeps the prior bundle so the UI
        // stays usable. The toast is the consumer's responsibility.
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn('[i18n] bundle fetch failed', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language, fallbackBundle]);

  const t = useCallback(
    (scope: string, key: string, params?: Record<string, string | number>): string => {
      const result = resolve({
        scope,
        key,
        language,
        bundle,
        ...(fallbackBundle !== undefined ? { fallbackBundle } : {}),
        ...(params ? { params } : {}),
      });
      if (import.meta.env.DEV && result.outcome !== 'requested') {
        const target = result.outcome === 'en' ? 'en' : 'placeholder';
        // eslint-disable-next-line no-console
        console.warn(
          `[i18n] missing ${language}: ${scope}.${key} → fell back to ${target}`,
        );
      }
      return result.value;
    },
    [language, bundle, fallbackBundle],
  );

  const value = useMemo<TranslationContextValue>(
    () => ({ language, bundle, fallbackBundle, t }),
    [language, bundle, fallbackBundle, t],
  );

  return (
    <TranslationContext.Provider value={value}>
      {children}
    </TranslationContext.Provider>
  );
}

/** Internal accessor — `useTranslation` is the public-facing wrapper. */
export function useTranslationContext(): TranslationContextValue {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error(
      '[i18n] useTranslation called outside <TranslationProvider>; wrap your app tree first.',
    );
  }
  return ctx;
}
