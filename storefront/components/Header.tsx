import Link from 'next/link';
import type { ReactNode } from 'react';
import type { I18nConfigResponse } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { CompareCounterLink } from './CompareToggle';

/**
 * Reference-theme header. Themes replace this component with their own
 * markup; the props contract (I18nConfigResponse + active locale) is the
 * stable surface.
 */
export function Header(props: {
  config: I18nConfigResponse;
  locale: string;
}): ReactNode {
  const t = tForLocale(props.locale);
  return (
    <header className="b2b-header">
      <div className="b2b-header__inner">
        <Link href="/" className="b2b-header__brand">
          B2B Platform
        </Link>
        <nav className="b2b-header__nav" aria-label="Primary">
          <Link href="/catalog">{t('nav.catalog')}</Link>
          <Link href="/search">{t('nav.search')}</Link>
          <CompareCounterLink href="/compare" />
        </nav>
        <form action="/search" method="GET" className="b2b-header__search" role="search">
          <input
            type="search"
            name="q"
            placeholder={t('search.placeholder')}
            aria-label={t('common.searchAction')}
          />
          <button type="submit">{t('common.searchAction')}</button>
        </form>
        <LocaleSwitcher config={props.config} locale={props.locale} />
      </div>
    </header>
  );
}

function LocaleSwitcher(props: { config: I18nConfigResponse; locale: string }): ReactNode {
  if (props.config.languages.length <= 1) return null;
  return (
    <form className="b2b-header__locale" action="" method="GET">
      <label htmlFor="b2b-locale">Language</label>
      <select id="b2b-locale" name="lang" defaultValue={props.locale}>
        {props.config.languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
          </option>
        ))}
      </select>
      <button type="submit">OK</button>
    </form>
  );
}
