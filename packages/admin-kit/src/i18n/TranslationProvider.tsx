// React Context provider for the Admin UI i18n runtime — feature 019.
//
// Holds the current language and the merged bundle for that language.
// Re-renders the entire tree without sign-out when the language flips
// (FR-005, SC-002). Boot-time fetch is on-demand: the provider issues
// a single `getBundles(language)` call when its `language` prop changes
// and caches the response in state.
//
// Missing translations log a `console.warn` in development only
// (research §R8); production stays silent. Each distinct subject is reported
// once per module registry — see `reportedSubjects` below for why a per-render
// repeat is a CI defect and not a nuisance.

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

/**
 * Subjects the two development diagnostics below have already reported.
 *
 * Both of them state a fact about a *subject* — this language's bundle cannot be
 * fetched; this key is not in it — and both sit on a path that runs again for
 * reasons that have nothing to do with whether the fact changed. `t()` is called
 * during render, so a missing key is re-discovered on every render of every
 * component that reads it; the boot effect runs once per provider mount, so a
 * failing endpoint is re-discovered once per mount. Neither repetition is wrong
 * and neither is news.
 *
 * It was measured as a CI defect rather than a nuisance. Master pipeline 14265's
 * `test:frontend` (job 55801) failed and the reason was unobtainable: the trace
 * ends in `Job's log exceeded limit of 4194304 bytes`, vitest prints its failure
 * summary last, and the summary was past the cut. One green run of that job's
 * command is **5 509 606 bytes**, of which 3 537 037 (64.2%) are 38 201
 * missing-key lines carrying 920 distinct keys, and a further 1 406 522 (25.5%)
 * are 673 copies of one fetch failure, each with a ten-frame stack.
 * `admin/test/kit/kit-i18n-diagnostic-volume.test.tsx` holds the census and the
 * two mechanisms.
 *
 * The first occurrence keeps its full form, stack included — that is the
 * diagnostic, and one copy of it costs nothing. What is dropped is an exact
 * repeat, and deliberately without a running count: "`core.appShell.nav.home` is
 * missing" is the entire signal, and "it is missing 1 065 times" is a fact about
 * how often the tree re-rendered.
 *
 * Module scope, so the memory is one module registry: one page load in a browser,
 * one test file under vitest. That is the right granularity in both — the log
 * still attributes the key to the file that surfaced it — and it needs no reset
 * hook, which a React provider has nowhere to put. The set is bounded by the
 * number of distinct keys the application names.
 */
const reportedSubjects = new Set<string>();

/** Report `args` unless this `subject` has already been reported in this registry. */
function warnOncePerSubject(subject: string, ...args: readonly unknown[]): void {
  if (reportedSubjects.has(subject)) return;
  reportedSubjects.add(subject);
  console.warn(...args);
}

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
          // The subject is the language whose bundle could not be fetched, so a
          // second language failing is still reported; the same one failing on
          // the next mount is not.
          warnOncePerSubject(
            `bundle-fetch:${language}`,
            '[i18n] bundle fetch failed',
            err,
          );
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
        // The subject is the key in this language, and the outcome is part of it:
        // a key that stops resolving from `en` and starts resolving to a
        // placeholder is a different fact, and says so.
        warnOncePerSubject(
          `missing:${language}:${scope}.${key}:${target}`,
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
