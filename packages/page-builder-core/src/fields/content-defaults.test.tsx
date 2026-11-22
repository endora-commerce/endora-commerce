// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts/platform-language';
import {
  PAGE_BUILDER_CONTENT_DEFAULTS,
  contentDefaultFor,
  contentDefaultsIn,
  withContentDefaultProps,
  type PageBuilderContentDefaultKey,
} from './content-defaults-table.js';
import { PageBuilderContentLocaleProvider, useContentDefault, useContentLocale } from './content-defaults.js';

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

  it('the latest-posts read-more label has a default in each language', () => {
    expect(contentDefaultFor('pl-PL', 'latestPosts.readMoreLabel')).toBe('Czytaj więcej');
    expect(contentDefaultFor('en-US', 'latestPosts.readMoreLabel')).toBe('Read more');
  });
});

describe('withContentDefaultProps (#1684)', () => {
  const config = {
    components: {
      'blog.LatestPosts': { render: () => null, defaultProps: { readMoreLabel: 'Read more', limit: 6 } },
      'cms.Text': { render: () => null, defaultProps: { text: 'Text' } },
    },
  };
  const map = { 'blog.LatestPosts': { readMoreLabel: 'latestPosts.readMoreLabel' } } as const;

  it('seeds the mapped default props of a block in the content locale, and leaves the rest', () => {
    const localized = withContentDefaultProps(config, 'pl-PL', map);
    expect(localized.components['blog.LatestPosts'].defaultProps).toEqual({ readMoreLabel: 'Czytaj więcej', limit: 6 });
    expect(localized.components['cms.Text']).toBe(config.components['cms.Text']);
    // The input config is not changed.
    expect(config.components['blog.LatestPosts'].defaultProps.readMoreLabel).toBe('Read more');
  });

  it('ignores a mapped block the config does not offer', () => {
    const localized = withContentDefaultProps({ components: {} }, 'pl', map);
    expect(localized.components).toEqual({});
  });
});

/**
 * Issue #1684, section presets — a module that seeds more content than this
 * table holds (the cms section presets' placeholder copy) keeps its own
 * per-language table and reads its row through the same lookup, in the content
 * locale the provider names.
 */
describe('contentDefaultsIn and useContentLocale (#1684)', () => {
  const table = { en: { greeting: 'Hello' }, pl: { greeting: 'Cześć' } } as const;

  it.each([
    ['pl-PL', 'Cześć'],
    ['en', 'Hello'],
    // A language with no row is English, never another language.
    ['de', 'Hello'],
    [null, 'Hello'],
  ])('answers the row of the content locale %j', (locale, expected) => {
    expect(contentDefaultsIn(table, locale).greeting).toBe(expected);
  });

  it('is the lookup the page builder\'s own defaults go through', () => {
    expect(contentDefaultsIn(PAGE_BUILDER_CONTENT_DEFAULTS, 'pl')['readMore.summary']).toBe(
      contentDefaultFor('pl', 'readMore.summary'),
    );
  });

  function LocaleProbe(): ReactElement {
    return <output>{useContentLocale() ?? '(none)'}</output>;
  }

  it('reads the locale the provider names, and none outside one', () => {
    expect(read(<PageBuilderContentLocaleProvider locale="pl-PL"><LocaleProbe /></PageBuilderContentLocaleProvider>)).toBe('pl-PL');
    act(() => root?.unmount());
    expect(read(<LocaleProbe />)).toBe('(none)');
  });
});
