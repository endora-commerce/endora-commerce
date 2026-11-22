'use client';

import { createContext, useCallback, useContext, type ReactElement, type ReactNode } from 'react';
import { contentDefaultFor, type ContentDefault } from './content-defaults-table.js';

// Issue #1684 — the table and the pure helpers sit in `content-defaults-table.ts`,
// with no `'use client'`, so a server render can call them.

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

/**
 * The content locale the nearest `PageBuilderContentLocaleProvider` names, or
 * `null` outside one. For a module that seeds content from its own table:
 * `contentDefaultsIn(table, useContentLocale())`.
 */
export function useContentLocale(): string | null {
  return useContext(ContentLocaleContext);
}

/** The content defaults in the edited content locale (see `PAGE_BUILDER_CONTENT_DEFAULTS`). */
export function useContentDefault(): ContentDefault {
  const locale = useContentLocale();
  return useCallback<ContentDefault>((key) => contentDefaultFor(locale, key), [locale]);
}

