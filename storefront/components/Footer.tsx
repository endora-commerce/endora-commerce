import type { ReactNode } from 'react';

/**
 * Industria-themed footer. Five-column dark layout with brand panel,
 * shop, account, support, and a newsletter sign-up.
 */
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
    <footer className="industria-footer">
      <div className="mx-auto max-w-[1360px] px-[24px]">
        {props.top}
        <div className="industria-footer__grid">
          <div className="industria-footer__brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="industria-header__mark">IN</span>
              <strong style={{ fontSize: 16, color: '#fff' }}>Industria</strong>
            </div>
            <p>
              Hurtownia B2B komponentów przemysłowych. Łożyska, napędy, automatyka, elektryka,
              pneumatyka i narzędzia. Wysyłka tego samego dnia, faktura z odroczonym terminem
              płatności i pełna dokumentacja techniczna.
            </p>
          </div>

          <div className="industria-footer__col">
            <h5>Sklep</h5>
            <a href="/catalog">Katalog</a>
            <a href="/c/fasteners">Łączniki</a>
            <a href="/c/tools">Narzędzia</a>
            <a href="/c/electronics">Elektronika</a>
            <a href="/c/safety">BHP</a>
            <a href="/quick-order">Quick Order</a>
          </div>

          <div className="industria-footer__col">
            <h5>Konto B2B</h5>
            <a href="/account">Moje konto</a>
            <a href="/orders">Zamówienia</a>
            <a href="/invoices">Faktury</a>
            <a href="/quote-requests">RFQ — zapytania ofertowe</a>
            <a href="/shopping-lists">Listy zakupowe</a>
            <a href="/credit-limit">Limit kredytowy</a>
          </div>

          <div className="industria-footer__col">
            <h5>Wsparcie</h5>
            {supportLinks.map((l) => (
              <a key={l.path} href={`/${l.path}`}>
                {l.title}
              </a>
            ))}
          </div>

          <div className="industria-footer__col industria-footer__newsletter">
            <h5>Newsletter techniczny</h5>
            <p style={{ fontSize: 12, color: '#a1a1aa', margin: '0 0 12px' }}>
              Nowości katalogowe, promocje cenowe i raporty dostępności.
            </p>
            <form action="/newsletter" method="POST">
              <input type="email" name="email" placeholder="adres@firma.pl" required />
              <button type="submit" className="btn btn--primary btn--block btn--sm">
                Zapisz się
              </button>
            </form>
          </div>
        </div>

        {props.bottom}
        <div className="industria-footer__bottom">
          <span>
            &copy; {new Date().getFullYear()} Industria B2B Sp. z o.o. · NIP 7251234567 · KRS
            0000987654
          </span>
          {props.copyright}
          <span style={{ display: 'inline-flex', gap: 16 }}>
            <a href="/regulamin">Regulamin</a>
            <a href="/polityka-prywatnosci">Polityka prywatności</a>
            <a href="/cookies">Cookies</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
