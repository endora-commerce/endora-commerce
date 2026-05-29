import Link from 'next/link';
import type { ReactNode } from 'react';
import { getCategoryTree } from '../lib/api/catalog';
import { getServerContext } from '../lib/server-context';

export const metadata = {
  title: '404 — strona nie została znaleziona · B2B Platform',
  robots: { index: false, follow: false },
};

interface PopularCategory {
  slug: string;
  name: string;
  count: number;
}

const FALLBACK_CATEGORIES: PopularCategory[] = [
  { slug: 'fasteners', name: 'Łączniki', count: 4218 },
  { slug: 'tools', name: 'Narzędzia', count: 2851 },
  { slug: 'electronics', name: 'Elektronika', count: 6104 },
  { slug: 'safety', name: 'BHP', count: 5293 },
  { slug: 'screws', name: 'Wkręty', count: 3162 },
  { slug: 'bolts', name: 'Śruby', count: 1947 },
];

export default async function NotFound(): Promise<ReactNode> {
  const { ctx } = await getServerContext();
  const tree = await getCategoryTree(ctx).catch(
    () => [] as Awaited<ReturnType<typeof getCategoryTree>>,
  );
  const popular: PopularCategory[] =
    tree.length > 0
      ? tree.slice(0, 6).map((c) => ({ slug: c.slug, name: c.name, count: c.productCount }))
      : FALLBACK_CATEGORIES;

  return (
    <section className="container section industria-404">
      <div className="industria-404__inner">
        <div className="industria-404__copy">
          <span className="industria-404__eyebrow">
            <span className="dot" /> Błąd 404 · strona nie istnieje
          </span>
          <div className="industria-404__num" aria-hidden="true">
            404
          </div>
          <h1>Nie znaleźliśmy tej strony.</h1>
          <p className="industria-404__lead">
            Adres, który próbujesz otworzyć, mógł zostać przeniesiony albo nigdy nie istniał.
            Sprawdź pisownię w pasku adresu lub skorzystaj z poniższych skrótów — z reguły
            wystarczy jedno kliknięcie, żeby trafić tam, gdzie chcesz.
          </p>

          <form action="/catalog" method="get" className="industria-404__search" role="search">
            <label htmlFor="not-found-q" className="industria-404__sr">
              Wyszukaj w katalogu
            </label>
            <input
              id="not-found-q"
              name="q"
              type="search"
              placeholder="Wyszukaj produkt, SKU, producenta…"
              autoComplete="off"
            />
            <button type="submit" className="btn btn--primary btn--lg">
              Szukaj
            </button>
          </form>

          <div className="industria-404__ctas">
            <Link href="/" className="btn btn--dark btn--lg">
              Wróć na stronę główną
            </Link>
            <Link href="/catalog" className="btn btn--outline btn--lg">
              Przeglądaj katalog
            </Link>
            <Link href="/quote-requests" className="btn btn--ghost btn--lg">
              Wyślij zapytanie ofertowe
            </Link>
          </div>
        </div>

        <aside className="industria-404__side" aria-label="Najczęściej wybierane">
          <h2>Najpopularniejsze działy</h2>
          <ul className="industria-404__cats">
            {popular.map((c) => (
              <li key={c.slug}>
                <Link href={`/c/${c.slug}`}>
                  <span>{c.name}</span>
                  <em>{c.count.toLocaleString('pl-PL')} produktów</em>
                </Link>
              </li>
            ))}
          </ul>

          <div className="industria-404__support">
            <h3>Potrzebujesz pomocy?</h3>
            <p>
              <a href="mailto:bok@b2b-platform.local">bok@b2b-platform.local</a>
            </p>
            <p>
              <a href="tel:+48800000000">+48 800 000 000</a>
              <span className="muted"> · pn–pt 8:00–17:00</span>
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
