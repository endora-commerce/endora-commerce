import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { TranslationProvider } from '../../src/i18n/TranslationProvider';
import type { Bundle } from '../../src/i18n/types';

/**
 * Test wrapper that mounts a component inside the admin i18n
 * `TranslationProvider` with a synchronous in-memory bundle so the
 * tree can call `useTranslation` without hitting the network.
 */
export function renderWithI18n(
  ui: ReactElement,
  bundle: Bundle = {},
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderResult {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language="en" initialBundle={bundle}>
      <>{children}</>
    </TranslationProvider>
  );
  return render(ui, { wrapper, ...options });
}

/** Minimal bundle that resolves every key to itself so tests can
 *  query the DOM by the key rather than locale-specific copy. */
export function passthroughBundle(scope: string, keys: string[]): Bundle {
  const entries: Record<string, string> = {};
  for (const k of keys) entries[k] = k;
  return { [scope]: entries };
}
