'use client';

import { Suspense, useEffect, useState, useTransition, type ChangeEvent, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CurrencyPicker } from '../lib/dictionary/pickers/CurrencyPicker';
import { useDictionary } from '../lib/dictionary/DictionaryProvider';
import { useUrlLanguageState } from '../lib/i18n/localized-link';
import { localizePath, stripLocalePrefix } from '../lib/i18n/locale-path';

/**
 * Header language + currency switchers.
 *
 * The currency is a preference: a site-wide cookie and a refresh of the server
 * tree, so `getServerContext` picks it up on the next render.
 *
 * The language is not (feature 167, `specs/167-storefront-locale-path/`): it is the
 * first segment of the URL, which beats any cookie (OR-4). So the language switcher
 * is a list of real links, one per channel language, to the current page in that
 * language (OR-6) — it works without JavaScript. A product page's English key differs
 * from its Polish one, so after hydration each option takes the page's own
 * `<link rel="alternate" hreflang>` when the head has one; without JavaScript the
 * generic link still arrives through the product page's 307 (FR-024). Following an
 * option also writes the `lang` cookie (OR-11), which chooses where the next
 * unprefixed visit is sent; the click handler never cancels the navigation.
 */

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function preferenceCookie(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/** The cookie the language switcher writes (OR-11). */
export function languageCookie(languageCode: string): string {
  return preferenceCookie('lang', languageCode);
}

function setPreferenceCookie(name: string, value: string): void {
  document.cookie = preferenceCookie(name, value);
}

/** The `hreflang` alternates the page published in its head, by language code. */
/**
 * The path, query and fragment of an alternate's `href`. The head's alternates are
 * absolute on the configured site URL (`metadataBase`); the switcher keeps the visitor
 * on the origin they are on, which may be another host serving the channel.
 */
export function alternatePath(href: string): string | null {
  try {
    const url = new URL(href, 'http://origin.invalid');
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function documentAlternates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]')) {
    const code = link.getAttribute('hreflang');
    const href = link.getAttribute('href');
    const path = href ? alternatePath(href) : null;
    if (code && path && code !== 'x-default') out[code.toLowerCase()] = path;
  }
  return out;
}

function LocaleLinks({ label, search }: { label: string; search: string }): ReactNode {
  const state = useUrlLanguageState();
  const pathname = usePathname() ?? '/';
  const dictionary = useDictionary();
  const [alternates, setAlternates] = useState<Record<string, string>>({});
  useEffect(() => {
    setAlternates(documentAlternates());
  }, [pathname, search]);

  if (state.languages.length < 2) return null;
  const logicalPath = stripLocalePrefix(pathname, state);
  const nativeLabel = (code: string): string =>
    dictionary.languages.find((l) => l.code.toLowerCase() === code.toLowerCase())?.nativeLabel || code;

  return (
    <nav aria-label={label} className="industria-topbar__switcher">
      <ul className="flex gap-2">
        {state.languages.map((language) => {
          const code = language.languageCode;
          const href = alternates[code.toLowerCase()] ?? localizePath(`${logicalPath}${search}`, state, code);
          return (
            <li key={code}>
              <a
                href={href}
                hrefLang={code}
                lang={code}
                aria-current={code === state.current ? 'page' : undefined}
                onClick={() => setPreferenceCookie('lang', code)}
              >
                {nativeLabel(code)}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function LocaleLinksWithSearch({ label }: { label: string }): ReactNode {
  const params = useSearchParams();
  const query = params?.toString() ?? '';
  return <LocaleLinks label={label} search={query ? `?${query}` : ''} />;
}

/** The language switcher: one link per channel language; hidden for a single-language channel. */
export function LocaleSwitcher({ label }: { label: string }): ReactNode {
  return (
    <Suspense fallback={<LocaleLinks label={label} search="" />}>
      <LocaleLinksWithSearch label={label} />
    </Suspense>
  );
}

export function CurrencySwitcher({
  currency,
  label,
}: {
  currency?: string | undefined;
  /** The switcher's caption, in the page's language ("Currency:"). */
  label: string;
}): ReactNode {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setPreferenceCookie('currency', event.target.value);
    startTransition(() => router.refresh());
  };
  return (
    <div className="industria-topbar__switcher">
      <label htmlFor="b2b-currency">{label}</label>
      {currency ? (
        <CurrencyPicker id="b2b-currency" name="currency" value={currency} onChange={onChange} />
      ) : (
        <CurrencyPicker id="b2b-currency" name="currency" onChange={onChange} />
      )}
    </div>
  );
}
