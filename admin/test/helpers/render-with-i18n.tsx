import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle, SupportedAdminLanguage } from '@endora-commerce/admin-kit/i18n';

/**
 * Test wrapper that mounts a component inside the admin i18n
 * `TranslationProvider` with a synchronous in-memory bundle so the
 * tree can call `useTranslation` without hitting the network.
 *
 * `language` sets the admin language (English by default). For another
 * language the same bundle is also handed over as the English fallback, so the
 * provider does not fetch one.
 */
export function renderWithI18n(
  ui: ReactElement,
  bundle: Bundle = {},
  options?: Omit<RenderOptions, 'wrapper'> & { language?: SupportedAdminLanguage },
): RenderResult {
  const { language = 'en', ...renderOptions } = options ?? {};
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider
      language={language}
      initialBundle={bundle}
      {...(language === 'en' ? {} : { initialFallbackBundle: bundle })}
    >
      <>{children}</>
    </TranslationProvider>
  );
  return render(ui, { wrapper, ...renderOptions });
}

/** Minimal bundle that resolves every key to itself so tests can
 *  query the DOM by the key rather than locale-specific copy. */
export function passthroughBundle(scope: string, keys: string[]): Bundle {
  const entries: Record<string, string> = {};
  for (const k of keys) entries[k] = k;
  return { [scope]: entries };
}
