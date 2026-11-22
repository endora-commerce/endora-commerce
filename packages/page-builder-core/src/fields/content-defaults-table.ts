import { supportedLanguageOf, type SupportedLanguage } from '@endora-commerce/contracts/platform-language';

/**
 * The content the page builder itself seeds into a document — the read-more
 * passage's summary, and a block's copy-carrying default props such as the
 * latest posts' read-more label (issue #1684).
 *
 * This is **content**, not the controls' copy: it is saved with the page and
 * printed on the storefront as stored, so it is written in the **content
 * locale being edited**, never in the operator's admin language — that is
 * `useFieldText`'s job, and the two differ whenever a Polish operator
 * edits an English page. It is therefore not read from an admin bundle
 * (which holds only the admin's own language) but from this per-language
 * table, one entry per shipped language (`SupportedLanguage`), so adding a
 * language without its defaults does not compile. A content locale the
 * platform ships no defaults for gets the English.
 */
export const PAGE_BUILDER_CONTENT_DEFAULTS = {
  en: {
    'readMore.summary': 'Read more',
    'latestPosts.readMoreLabel': 'Read more',
  },
  pl: {
    'readMore.summary': 'Czytaj więcej',
    'latestPosts.readMoreLabel': 'Czytaj więcej',
  },
} as const satisfies Record<SupportedLanguage, Record<string, string>>;

export type PageBuilderContentDefaultKey = keyof (typeof PAGE_BUILDER_CONTENT_DEFAULTS)['en'];

/** Looks one content default up in the content locale the host names. */
export type ContentDefault = (key: PageBuilderContentDefaultKey) => string;

/**
 * The row of a per-language content-defaults `table` for the BCP-47 `locale`
 * (`pl-PL`, `pl`) — the English row for a language the platform ships no row
 * for, never the admin's. The one lookup every content default goes through:
 * this file's own table, and a module's table of the content it seeds (the
 * cms section presets' placeholder copy).
 */
export function contentDefaultsIn<Table extends Readonly<Record<SupportedLanguage, unknown>>>(
  table: Table,
  locale: string | null | undefined,
): Table[SupportedLanguage] {
  return table[supportedLanguageOf(locale)];
}

/** The default `key` in the BCP-47 `locale` (`pl-PL`, `pl`), English when it has none. */
export function contentDefaultFor(locale: string | null | undefined, key: PageBuilderContentDefaultKey): string {
  const row: Record<PageBuilderContentDefaultKey, string> = contentDefaultsIn(PAGE_BUILDER_CONTENT_DEFAULTS, locale);
  return row[key];
}

/** Which default props of which block are content defaults: block name → prop → key. */
export type ContentDefaultPropsMap = Readonly<Record<string, Readonly<Record<string, PageBuilderContentDefaultKey>>>>;

/**
 * The config with each mapped block's default props seeded in the content
 * `locale` — what a block dropped from the drawer starts with. Puck reads
 * `defaultProps` outside React, so the host applies this to the config it
 * builds rather than through `PageBuilderContentLocaleProvider`. A
 * block the map names and the config does not offer is skipped; the input is
 * not changed.
 */
export function withContentDefaultProps<C extends { components: Record<string, unknown> }>(
  config: C,
  locale: string | null | undefined,
  map: ContentDefaultPropsMap,
): C {
  const components: Record<string, unknown> = { ...config.components };
  for (const [name, props] of Object.entries(map)) {
    const component = components[name] as { defaultProps?: Record<string, unknown> } | undefined;
    if (!component) continue;
    const defaults: Record<string, unknown> = { ...component.defaultProps };
    for (const [prop, key] of Object.entries(props)) defaults[prop] = contentDefaultFor(locale, key);
    components[name] = { ...component, defaultProps: defaults };
  }
  return { ...config, components };
}
