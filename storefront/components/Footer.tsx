import type { ReactNode } from 'react';

/**
 * Industria-themed footer. Five-column dark layout with brand panel,
 * shop, account, support, and a newsletter sign-up.
 *
 * Migrated to Tailwind utilities (feature 041). The footer is dark in both themes,
 * so colours use arbitrary hex/opacity values; only the surface bg flips under the
 * `.is-dark` scope via the `dark:` variant.
 */
const COL_HEADING =
  'mb-[14px] font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[#fafafa]';
const COL_LINK = 'block py-[5px] text-[13px] text-[#a1a1aa] hover:text-white';

export function Footer(props: {
  cmsLinks?: Array<{ path: string; title: string }>;
  top?: ReactNode;
  bottom?: ReactNode;
  copyright?: ReactNode;
}): ReactNode {
  const supportLinks = props.cmsLinks && props.cmsLinks.length > 0
    ? props.cmsLinks
    : [
        { path: 'kontakt', title: 'Kontakt' },
        { path: 'reklamacje', title: 'Reklamacje i zwroty' },
        { path: 'dostawa', title: 'Dostawa i płatności' },
        { path: 'certyfikaty', title: 'Certyfikaty i zgodność' },
        { path: 'pomoc', title: 'Centrum pomocy' },
      ];

  return (
    <footer className="mt-[64px] bg-[#18181b] pt-[56px] pb-[28px] text-[#d4d4d8] dark:bg-[#050507]">
      <div className="mx-auto max-w-[1360px] px-[24px]">
        {props.top}
        <div className="grid grid-cols-[2fr_repeat(4,1fr)] gap-8 border-b border-white/8 pb-9 max-[920px]:grid-cols-2">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="industria-header__mark bg-white text-[var(--ink-900)]">IN</span>
              <strong className="text-[16px] text-white">Industria</strong>
            </div>
            <p className="mt-[14px] max-w-[280px] leading-[1.5] text-[#a1a1aa]">
              Hurtownia B2B komponentów przemysłowych. Łożyska, napędy, automatyka, elektryka,
              pneumatyka i narzędzia. Wysyłka tego samego dnia, faktura z odroczonym terminem
              płatności i pełna dokumentacja techniczna.
            </p>
          </div>

          <div>
            <h5 className={COL_HEADING}>Sklep</h5>
            <a className={COL_LINK} href="/catalog">Katalog</a>
            <a className={COL_LINK} href="/c/fasteners">Łączniki</a>
            <a className={COL_LINK} href="/c/tools">Narzędzia</a>
            <a className={COL_LINK} href="/c/electronics">Elektronika</a>
            <a className={COL_LINK} href="/c/safety">BHP</a>
            <a className={COL_LINK} href="/quick-order">Quick Order</a>
          </div>

          <div>
            <h5 className={COL_HEADING}>Konto B2B</h5>
            <a className={COL_LINK} href="/account">Moje konto</a>
            <a className={COL_LINK} href="/orders">Zamówienia</a>
            <a className={COL_LINK} href="/invoices">Faktury</a>
            <a className={COL_LINK} href="/quote-requests">RFQ — zapytania ofertowe</a>
            <a className={COL_LINK} href="/shopping-lists">Listy zakupowe</a>
            <a className={COL_LINK} href="/credit-limit">Limit kredytowy</a>
          </div>

          <div>
            <h5 className={COL_HEADING}>Wsparcie</h5>
            {supportLinks.map((l) => (
              <a key={l.path} className={COL_LINK} href={`/${l.path}`}>
                {l.title}
              </a>
            ))}
          </div>

          <div>
            <h5 className={COL_HEADING}>Newsletter techniczny</h5>
            <p className="mb-3 text-[12px] text-[#a1a1aa]">
              Nowości katalogowe, promocje cenowe i raporty dostępności.
            </p>
            <form action="/newsletter" method="POST">
              <input
                className="mb-2 w-full rounded-md border border-white/12 bg-white/4 px-2.5 py-2 text-[13px] text-white placeholder:text-[#71717a]"
                type="email"
                name="email"
                placeholder="adres@firma.pl"
                required
              />
              <button type="submit" className="btn btn--primary btn--block btn--sm">
                Zapisz się
              </button>
            </form>
          </div>
        </div>

        {props.bottom}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-[22px] text-[12px] text-[#71717a]">
          <span>
            &copy; {new Date().getFullYear()} Industria B2B Sp. z o.o. · NIP 7251234567 · KRS
            0000987654
          </span>
          {props.copyright}
          <span className="inline-flex gap-4">
            <a className="text-[#a1a1aa] hover:text-white" href="/regulamin">Regulamin</a>
            <a className="text-[#a1a1aa] hover:text-white" href="/polityka-prywatnosci">
              Polityka prywatności
            </a>
            <a className="text-[#a1a1aa] hover:text-white" href="/cookies">Cookies</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
