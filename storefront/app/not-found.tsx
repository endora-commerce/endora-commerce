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
    <section className="mx-auto max-w-[1360px] px-[24px] section pt-[48px] pb-[80px]">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-[40px] min-[960px]:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)] min-[960px]:gap-[56px]">
        <div className="max-w-[720px]">
          <span className="inline-flex items-center gap-[8px] rounded-full border border-line bg-surface-alt px-[10px] py-[6px] font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
            <span className="inline-block h-[6px] w-[6px] rounded-full bg-bad shadow-[0_0_0_3px_rgba(185,28,28,0.12)]" />{' '}
            Błąd 404 · strona nie istnieje
          </span>
          <div
            className="mb-[12px] mt-[20px] bg-linear-to-b from-fg to-muted bg-clip-text font-mono text-[clamp(96px,18vw,192px)] font-semibold leading-[0.92] tracking-[-0.04em] text-transparent"
            aria-hidden="true"
          >
            404
          </div>
          <h1 className="mb-[12px] text-[clamp(28px,4vw,40px)] leading-[1.1] tracking-[-0.02em]">
            Nie znaleźliśmy tej strony.
          </h1>
          <p className="mb-[28px] max-w-[56ch] text-[15px] leading-[1.55] text-muted">
            Adres, który próbujesz otworzyć, mógł zostać przeniesiony albo nigdy nie istniał.
            Sprawdź pisownię w pasku adresu lub skorzystaj z poniższych skrótów — z reguły
            wystarczy jedno kliknięcie, żeby trafić tam, gdzie chcesz.
          </p>

          <form
            action="/catalog"
            method="get"
            className="mb-[24px] flex max-w-[560px] items-stretch gap-[8px]"
            role="search"
          >
            <label htmlFor="not-found-q" className="sr-only">
              Wyszukaj w katalogu
            </label>
            <input
              id="not-found-q"
              name="q"
              type="search"
              placeholder="Wyszukaj produkt, SKU, producenta…"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-[14px] py-[12px] text-fg placeholder:text-subtle"
            />
            <button type="submit" className="btn btn--primary btn--lg">
              Szukaj
            </button>
          </form>

          <div className="flex flex-wrap gap-[10px]">
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

        <aside
          className="rounded-lg border border-line bg-surface p-[20px] shadow-sm"
          aria-label="Najczęściej wybierane"
        >
          <h2 className="mb-[14px] font-mono text-[14px] uppercase tracking-[0.06em] text-muted">
            Najpopularniejsze działy
          </h2>
          <ul className="m-0 mb-[20px] flex list-none flex-col gap-[2px] p-0">
            {popular.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/c/${c.slug}`}
                  className="-mx-[12px] flex items-baseline justify-between gap-[12px] rounded-md px-[12px] py-[10px] text-fg transition-colors hover:bg-surface-alt hover:text-accent"
                >
                  <span className="font-medium">{c.name}</span>
                  <em className="whitespace-nowrap font-mono text-[11px] not-italic text-muted">
                    {c.count.toLocaleString('pl-PL')} produktów
                  </em>
                </Link>
              </li>
            ))}
          </ul>

          <div className="border-t border-line pt-[16px]">
            <h3 className="mb-[10px] font-mono text-[14px] uppercase tracking-[0.06em] text-muted">
              Potrzebujesz pomocy?
            </h3>
            <p className="my-[4px] text-[13px]">
              <a href="mailto:bok@b2b-platform.local" className="font-medium text-fg hover:text-accent">
                bok@b2b-platform.local
              </a>
            </p>
            <p className="my-[4px] text-[13px]">
              <a href="tel:+48800000000" className="font-medium text-fg hover:text-accent">
                +48 800 000 000
              </a>
              <span className="text-muted"> · pn–pt 8:00–17:00</span>
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
