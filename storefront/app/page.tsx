import Link from 'next/link';
import type { ReactNode } from 'react';
import { listProducts, getCategoryTree } from '../lib/api/catalog';
import { getServerContext } from '../lib/server-context';
import { ProductCard } from '../components/ProductCard';
import { Hook } from '../components/Hook';

interface CatTile {
  href: string;
  name: string;
  count: number;
}

/**
 * Industria-themed landing page. Hero + 6-tile category grid + features +
 * bestseller product grid. Categories and products come from the backend;
 * the rest is editorial copy that ships with the theme.
 */
export default async function HomePage(): Promise<ReactNode> {
  const { ctx, locale } = await getServerContext();

  // Fetch real catalog data; if the backend is empty, the home page still
  // renders the marketing chrome.
  const [tree, products] = await Promise.all([
    getCategoryTree(ctx).catch(() => [] as Awaited<ReturnType<typeof getCategoryTree>>),
    listProducts({ limit: 4 }, ctx).catch(() => ({
      data: [],
      pagination: { limit: 4, nextCursor: null, hasMore: false },
    })),
  ]);

  const categoryTiles: CatTile[] = tree.length > 0
    ? tree.slice(0, 6).map((c) => ({
        href: `/c/${c.slug}`,
        name: c.name,
        count: c.productCount,
      }))
    : FALLBACK_CATEGORIES.map((c) => ({
        href: `/catalog?cat=${c.slug}`,
        name: c.name,
        count: c.count,
      }));

  return (
    <>
      <Hook code="homepage.top" />
      <section className="industria-hero">
        <div className="container industria-hero__inner">
          <div>
            <span className="industria-hero__eyebrow">
              <span className="dot" /> 120 000+ SKU · 84 producentów · wysyłka dziś
            </span>
            <h1>
              Komponenty przemysłowe
              <br />
              dostępne <em>od ręki</em>.
            </h1>
            <p className="industria-hero__lead">
              Hurtownia B2B dla utrzymania ruchu, integratorów automatyki i działów produkcji.
              Ceny netto, limit kredytowy, karty katalogowe, certyfikaty 3.1 — wszystko w jednym
              miejscu.
            </p>
            <div className="industria-hero__ctas">
              <Link href="/catalog" className="btn btn--dark btn--lg">
                Przeglądaj katalog <ArrowRightIcon />
              </Link>
              <Link href="/quick-order" className="btn btn--outline btn--lg">
                <LightningIcon /> Quick Order z CSV
              </Link>
            </div>
            <div className="industria-hero__stats">
              <div>
                <div className="industria-hero__stat__num">120k+</div>
                <span className="industria-hero__stat__label">Pozycji w magazynie</span>
              </div>
              <div>
                <div className="industria-hero__stat__num">84</div>
                <span className="industria-hero__stat__label">Producentów</span>
              </div>
              <div>
                <div className="industria-hero__stat__num">14:00</div>
                <span className="industria-hero__stat__label">Cut-off wysyłki</span>
              </div>
              <div>
                <div className="industria-hero__stat__num">98,4%</div>
                <span className="industria-hero__stat__label">Dostępność on-stock</span>
              </div>
            </div>
          </div>
          <div className="industria-hero__visual">
            <div className="industria-hero__visual__head">
              <span className="industria-hero__visual__head__title">SKU 6205-2RS · SKF</span>
              <span>on-stock · 1 280 szt. · WAW-01</span>
            </div>
            <div className="industria-hero__bigsku">
              <small>NOŚNOŚĆ DYNAMICZNA</small>
              14,0 kN
            </div>
            <div className="industria-hero__visual__tags">
              <span className="industria-hero__visual__tag">d 25 mm</span>
              <span className="industria-hero__visual__tag">D 52 mm</span>
              <span className="industria-hero__visual__tag">B 15 mm</span>
              <span className="industria-hero__visual__tag">14 000 obr/min</span>
              <span className="industria-hero__visual__tag">ISO 15:2017</span>
            </div>
            <div className="industria-hero__visual__cards">
              <div className="industria-hero__visual__card">
                <div className="ico"><DocIcon /></div>
                <div>
                  <strong>Karta katalogowa</strong>
                  <span>PDF · 1,2 MB</span>
                </div>
              </div>
              <div className="industria-hero__visual__card">
                <div className="ico"><ShieldIcon /></div>
                <div>
                  <strong>Certyfikat 3.1</strong>
                  <span>EN 10204</span>
                </div>
              </div>
              <div className="industria-hero__visual__card">
                <div className="ico"><LayersIcon /></div>
                <div>
                  <strong>Model 3D STEP</strong>
                  <span>2,8 MB</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container section">
        <div className="section__head">
          <div>
            <span className="section__eyebrow">01 / Asortyment</span>
            <h2>Sześć kluczowych działów</h2>
            <p>
              Drzewo kategorii odzwierciedla katalogi producentów — łatwo trafisz do tego, czego
              szukasz.
            </p>
          </div>
          <Link href="/catalog" className="btn btn--ghost">
            Zobacz wszystkie <ArrowRightIcon />
          </Link>
        </div>
        <div className="industria-cat-grid">
          {categoryTiles.map((c, i) => {
            const glyph = GLYPH_KEYS[i % GLYPH_KEYS.length] as keyof typeof GLYPHS;
            return (
              <Link key={c.href} href={c.href} className="industria-cat-tile">
                <div className="industria-cat-tile__icon">{GLYPHS[glyph]}</div>
                <h3 className="industria-cat-tile__name">{c.name}</h3>
                <span className="industria-cat-tile__count">
                  {c.count.toLocaleString('pl-PL')} produktów
                </span>
                <span className="industria-cat-tile__arrow"><ArrowUpRightIcon /></span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="container section" style={{ paddingTop: 0 }}>
        <div className="industria-features">
          <div className="industria-feature">
            <div className="industria-feature__icon"><TruckIcon size={20} /></div>
            <div>
              <h4>Wysyłka tego samego dnia</h4>
              <p>Cut-off 14:00. 98,4% pozycji on-stock w magazynie centralnym Warszawa-Okęcie.</p>
            </div>
          </div>
          <div className="industria-feature">
            <div className="industria-feature__icon"><WalletIcon size={20} /></div>
            <div>
              <h4>Limit kredytowy</h4>
              <p>Od 5 000 do 500 000 PLN. Faktura z odroczonym terminem 14/30/60 dni.</p>
            </div>
          </div>
          <div className="industria-feature">
            <div className="industria-feature__icon"><DocIcon size={20} /></div>
            <div>
              <h4>Karty katalogowe i CAD</h4>
              <p>Każdy produkt ma kartę PDF, model 3D STEP/DXF, deklarację RoHS.</p>
            </div>
          </div>
          <div className="industria-feature">
            <div className="industria-feature__icon"><SettingsIcon size={20} /></div>
            <div>
              <h4>Integracja z ERP</h4>
              <p>API REST, webhooki, eksport CSV/EDI. Quick Order dla 200+ pozycji.</p>
            </div>
          </div>
        </div>
      </section>

      {products.data.length > 0 ? (
        <section className="container section">
          <div className="section__head">
            <div>
              <span className="section__eyebrow">02 / Bestsellery</span>
              <h2>Najczęściej zamawiane w tym tygodniu</h2>
              <p>Gotowe do wysyłki, sprawdzone w utrzymaniu ruchu.</p>
            </div>
            <Link href="/catalog" className="btn btn--ghost">
              Cały bestseller <ArrowRightIcon />
            </Link>
          </div>
          <ul className="industria-product-grid">
            {products.data.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Hook code="homepage.bottom" />
    </>
  );
}

const FALLBACK_CATEGORIES = [
  { slug: 'lozyska', name: 'Łożyska', count: 4218 },
  { slug: 'napedy', name: 'Napędy i przekładnie', count: 2851 },
  { slug: 'automatyka', name: 'Automatyka', count: 6104 },
  { slug: 'elektryka', name: 'Elektryka przemysłowa', count: 5293 },
  { slug: 'pneumatyka', name: 'Pneumatyka i hydraulika', count: 3162 },
  { slug: 'narzedzia', name: 'Narzędzia i mocowania', count: 1947 },
];

const GLYPH_KEYS = ['bearing', 'gear', 'plc', 'spark', 'valve', 'wrench'] as const;

/* Inline SVG product glyphs — neutral line art consistent with the
 * Industria design language. Used as category iconography on the home
 * page, the product card placeholder, and the gallery placeholder. */
const STROKE = '#a8aeb8';

const GLYPHS: Record<string, ReactNode> = {
  bearing: (
    <svg viewBox="0 0 100 100" fill="none" stroke={STROKE} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="50" cy="50" r="42" />
      <circle cx="50" cy="50" r="32" />
      <circle cx="50" cy="50" r="22" />
      <circle cx="50" cy="50" r="12" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 100 100" fill="none" stroke={STROKE} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="50" cy="50" r="22" />
      <circle cx="50" cy="50" r="10" />
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => {
        const rad = (a * Math.PI) / 180;
        return (
          <line
            key={a}
            x1={50 + 22 * Math.cos(rad)}
            y1={50 + 22 * Math.sin(rad)}
            x2={50 + 32 * Math.cos(rad)}
            y2={50 + 32 * Math.sin(rad)}
          />
        );
      })}
    </svg>
  ),
  plc: (
    <svg viewBox="0 0 100 100" fill="none" stroke={STROKE} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="22" y="18" width="56" height="64" rx="3" />
      <rect x="28" y="26" width="44" height="14" />
      {[32, 40, 48, 56, 64].map((x) => (
        <circle key={x} cx={x} cy="48" r="2" />
      ))}
      <rect x="28" y="56" width="44" height="20" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 100 100" fill="none" stroke={STROKE} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="56 14 30 56 50 56 44 86 70 44 50 44 56 14" />
    </svg>
  ),
  valve: (
    <svg viewBox="0 0 100 100" fill="none" stroke={STROKE} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <line x1="14" y1="50" x2="38" y2="50" />
      <line x1="62" y1="50" x2="86" y2="50" />
      <polygon points="38 36 62 36 62 64 38 64" />
      <line x1="50" y1="36" x2="50" y2="20" />
      <circle cx="50" cy="16" r="6" />
    </svg>
  ),
  wrench: (
    <svg viewBox="0 0 100 100" fill="none" stroke={STROKE} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M70 14 a16 16 0 0 1 14 22 l-44 44 a8 8 0 0 1 -12 -12 l44 -44 a16 16 0 0 1 -2 -10 z" />
      <circle cx="78" cy="22" r="3" />
    </svg>
  ),
};

function svg(children: ReactNode, size = 16): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function ArrowRightIcon(): ReactNode {
  return svg(
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>,
    14,
  );
}
function ArrowUpRightIcon(): ReactNode {
  return svg(
    <>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </>,
    16,
  );
}
function LightningIcon(): ReactNode {
  return svg(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />, 14);
}
function DocIcon({ size = 16 }: { size?: number } = {}): ReactNode {
  return svg(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>,
    size,
  );
}
function ShieldIcon({ size = 16 }: { size?: number } = {}): ReactNode {
  return svg(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />, size);
}
function LayersIcon({ size = 16 }: { size?: number } = {}): ReactNode {
  return svg(
    <>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </>,
    size,
  );
}
function TruckIcon({ size = 18 }: { size?: number } = {}): ReactNode {
  return svg(
    <>
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </>,
    size,
  );
}
function WalletIcon({ size = 18 }: { size?: number } = {}): ReactNode {
  return svg(
    <>
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M16 12h6" />
    </>,
    size,
  );
}
function SettingsIcon({ size = 18 }: { size?: number } = {}): ReactNode {
  return svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>,
    size,
  );
}
