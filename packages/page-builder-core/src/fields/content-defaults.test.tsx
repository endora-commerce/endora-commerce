// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts/platform-language';
import {
  PAGE_BUILDER_CONTENT_DEFAULTS,
  PageBuilderContentLocaleProvider,
  contentDefaultFor,
  useContentDefault,
  type PageBuilderContentDefaultKey,
} from './content-defaults.js';

/**
 * Issue #1684 (UX audit, follow-up to #1680) — the content the page builder
 * inserts into a document (the read-more passage's summary) is written in the
 * **content locale being edited**, not in the operator's admin language and
 * not always in English. The host says which locale that is through
 * {@link PageBuilderContentLocaleProvider}.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function Probe({ name }: { name: PageBuilderContentDefaultKey }): ReactElement {
  const contentDefault = useContentDefault();
  return <output>{contentDefault(name)}</output>;
}

function read(node: ReactElement): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host.textContent ?? '';
}

describe('page-builder content defaults (#1684)', () => {
  it('every shipped language carries every default, and no other', () => {
    expect(Object.keys(PAGE_BUILDER_CONTENT_DEFAULTS).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
    const keys = Object.keys(PAGE_BUILDER_CONTENT_DEFAULTS.en).sort();
    for (const language of SUPPORTED_LANGUAGES) {
      expect(Object.keys(PAGE_BUILDER_CONTENT_DEFAULTS[language]).sort()).toEqual(keys);
      for (const value of Object.values(PAGE_BUILDER_CONTENT_DEFAULTS[language])) expect(value.trim()).not.toBe('');
    }
  });

  it.each([
    ['pl', 'Czytaj więcej'],
    ['pl-PL', 'Czytaj więcej'],
    ['PL_pl', 'Czytaj więcej'],
    ['en', 'Read more'],
    ['en-US', 'Read more'],
    // A content language the platform ships no defaults for falls back to English.
    ['de-DE', 'Read more'],
    ['', 'Read more'],
    [null, 'Read more'],
  ])('the read-more summary for the content locale %j is %j', (locale, expected) => {
    expect(contentDefaultFor(locale, 'readMore.summary')).toBe(expected);
    expect(read(<PageBuilderContentLocaleProvider locale={locale}><Probe name="readMore.summary" /></PageBuilderContentLocaleProvider>)).toBe(expected);
  });

  it('answers English outside a provider, so a host that names no locale keeps today\'s content', () => {
    expect(read(<Probe name="readMore.summary" />)).toBe('Read more');
  });
});
