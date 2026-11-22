'use client';

import { createContext, useCallback, useContext, type ReactElement, type ReactNode } from 'react';
import { supportedLanguageOf, type SupportedLanguage } from '@endora-commerce/contracts/platform-language';

/**
 * The content the page builder itself seeds into a document — today the
 * read-more passage's summary (issue #1684).
 *
 * This is **content**, not the controls' copy: it is saved with the page and
 * printed on the storefront as stored, so it is written in the **content
 * locale being edited**, never in the operator's admin language — that is
 * {@link useFieldText}'s job, and the two differ whenever a Polish operator
 * edits an English page. It is therefore not read from an admin bundle
 * (which holds only the admin's own language) but from this per-language
 * table, one entry per shipped language (`SupportedLanguage`), so adding a
 * language without its defaults does not compile. A content locale the
 * platform ships no defaults for gets the English.
 */
export const PAGE_BUILDER_CONTENT_DEFAULTS = {
  en: {
    'readMore.summary': 'Read more',
  },
  pl: {
    'readMore.summary': 'Czytaj więcej',
  },
} as const satisfies Record<SupportedLanguage, Record<string, string>>;

export type PageBuilderContentDefaultKey = keyof (typeof PAGE_BUILDER_CONTENT_DEFAULTS)['en'];

/** Looks one content default up in the content locale the host names. */
export type ContentDefault = (key: PageBuilderContentDefaultKey) => string;

/** The default `key` in the BCP-47 `locale` (`pl-PL`, `pl`), English when it has none. */
export function contentDefaultFor(locale: string | null | undefined, key: PageBuilderContentDefaultKey): string {
  const table: Record<PageBuilderContentDefaultKey, string> = PAGE_BUILDER_CONTENT_DEFAULTS[supportedLanguageOf(locale)];
  return table[key];
}

const ContentLocaleContext = createContext<string | null>(null);

/**
 * Names the content locale the page builder below is editing — the language
 * the host's `ContentLanguageTabs` selected. Outside one, content defaults are
 * English.
 */
export function PageBuilderContentLocaleProvider({
  locale,
  children,
}: {
  locale: string | null | undefined;
  children: ReactNode;
}): ReactElement {
  return <ContentLocaleContext.Provider value={locale ?? null}>{children}</ContentLocaleContext.Provider>;
}

/** The content defaults in the edited content locale (see {@link PAGE_BUILDER_CONTENT_DEFAULTS}). */
export function useContentDefault(): ContentDefault {
  const locale = useContext(ContentLocaleContext);
  return useCallback<ContentDefault>((key) => contentDefaultFor(locale, key), [locale]);
}
