import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { listProducts, getCategoryTree } from '../lib/api/catalog';
import { getCmsPageBySlug } from '../lib/api/cms';
import { getHomepageConfig } from '../lib/api/homepage';
import { getResolvedPricesBulk, type ResolvedPrice } from '../lib/api/pricing';
import { getServerContext } from '../lib/server-context';
import { ProductCard } from '../components/ProductCard';
import { CmsPageRenderer } from '../components/CmsPageRenderer';
import { HomeMobileStrip } from '../components/mobile/HomeMobileStrip';
import { Hook } from '../components/Hook';
import { OrganizationJsonLd } from '../components/seo/OrganizationJsonLd';
import { seo } from './seo';

/**
 * Indexable (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010/FR-012). The
 * canonical is the route pattern itself; `metadataBase` in the root layout
 * turns it into an absolute URL.
 */
export const metadata: Metadata = {
  alternates: { canonical: seo.route },
};

interface CatTile {
  href: string;
  name: string;
  count: number;
}

/**
 * Storefront home page.
 *
 * When an operator has chosen a CMS page as the home page (Settings → General
 * → "Home page CMS page"), that page is rendered here. Otherwise we fall back
 * to the built-in Industria-themed landing page below.
 */
export default async function HomePage(): Promise<ReactNode> {
  const { ctx, locale } = await getServerContext();

  // Operator-selected CMS home page takes precedence when it resolves to a
  // published page; any miss (unset, unpublished, deleted) falls through to
  // the built-in landing page so the home page always renders.
  const { cmsPageSlug } = await getHomepageConfig(ctx);
  if (cmsPageSlug) {
    const cmsPage = await getCmsPageBySlug(cmsPageSlug, ctx).catch(() => null);
    if (cmsPage) {
      // The `Organization` block rides on both render paths: a crawler that
      // fetched `/` while an operator had a CMS home page selected would
      // otherwise receive no structured data at all.
      return (
        <>
          <OrganizationJsonLd ctx={ctx} />
          <CmsPageRenderer page={cmsPage} />
        </>
      );
    }
  }

  // Fetch real catalog data; if the backend is empty, the home page still
  // renders the marketing chrome.
  const [tree, products] = await Promise.all([
    getCategoryTree(ctx).catch(() => [] as Awaited<ReturnType<typeof getCategoryTree>>),
    listProducts({ limit: 4 }, ctx).catch(() => ({
      data: [],
      pagination: { limit: 4, nextCursor: null, hasMore: false },
    })),
  ]);

  // Resolve settings-driven prices for the bestseller cards so their net/gross
  // presentation matches the PDP and cart. Without a `resolved` payload the
  // card falls back to a hardcoded "net + gross" pair that ignores the display
  // setting (the inconsistency this section otherwise showed).
  const bestsellerPrices: Map<string, ResolvedPrice> = products.data.length > 0
    ? await getResolvedPricesBulk(products.data.map((p) => p.id), {}, ctx).catch(
        () => new Map<string, ResolvedPrice>(),
      )
    : new Map<string, ResolvedPrice>();

  const categoryTiles: CatTile[] = tree.length > 0
    ? tree.slice(0, 6).map((c) => ({
        href: `/c/${c.slug}`,
        name: c.name,
        count: c.productCount,
      }))
    : FALLBACK_CATEGORIES.map((c) => ({
        href: `/c/${c.slug}`,
        name: c.name,
        count: c.count,
      }));

  const mobileChips = [
    { label: 'Wszystko', href: '/catalog', active: true },
    ...categoryTiles.slice(0, 4).map((c) => ({ label: c.name, href: c.href })),
  ];

  return (
    <>
      <OrganizationJsonLd ctx={ctx} />
      <Hook code="homepage.top" />
      {/* Feature 044 / US1 — mobile-only benefit strip + category chips. */}
      <HomeMobileStrip
        benefits={[
          { icon: 'truck', label: 'Wysyłka dziś' },
          { icon: 'wallet', label: 'Limit kredytowy' },
          { icon: 'doc', label: 'Faktura VAT' },
        ]}
        chips={mobileChips}
      />
      <section className="border-b border-line bg-surface bg-[radial-gradient(ellipse_at_top_right,rgba(29,78,216,0.04),transparent_60%)] pt-[56px] pb-[72px] max-md:pt-[28px] max-md:pb-[40px]">
        <div className="mx-auto grid max-w-[1360px] grid-cols-[minmax(0,5fr)_minmax(0,4fr)] items-center gap-[56px] px-[24px] max-[920px]:grid-cols-1">
          <div>
            <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface-alt px-[10px] py-[6px] font-mono text-[11px] tracking-[0.04em] text-muted">
              <span className="inline-block h-[6px] w-[6px] rounded-full bg-ok" /> 120 000+ SKU · 84
              producentów · wysyłka dziś
            </span>
            <h1 className="text-[56px] leading-[1.04] tracking-[-0.03em] max-[720px]:text-[38px] [&_em]:not-italic [&_em]:text-accent">
              Komponenty przemysłowe
              <br />
              dostępne <em>od ręki</em>.
            </h1>
            <p className="mt-6 mb-8 max-w-[540px] text-[16px] leading-[1.6] text-muted">
              Hurtownia B2B dla utrzymania ruchu, integratorów automatyki i działów produkcji.
              Ceny netto, limit kredytowy, karty katalogowe, certyfikaty 3.1 — wszystko w jednym
              miejscu.
            </p>
            <div className="mb-10 flex flex-wrap gap-3">
              <Link href="/catalog" className="btn btn--dark btn--lg">
                Przeglądaj katalog <ArrowRightIcon />
              </Link>
              <Link href="/quick-order" className="btn btn--outline btn--lg">
                <LightningIcon /> Quick Order z CSV
              </Link>
            </div>
            <div className="grid grid-cols-4 gap-[24px] max-[720px]:grid-cols-2">
              {[
                ['120k+', 'Pozycji w magazynie'],
                ['84', 'Producentów'],
                ['14:00', 'Cut-off wysyłki'],
                ['98,4%', 'Dostępność on-stock'],
              ].map(([num, label]) => (
                <div key={label}>
                  <div className="font-mono text-[22px] font-semibold tracking-[-0.02em] text-fg">
                    {num}
                  </div>
                  <span className="text-[11px] uppercase tracking-[0.06em] text-muted">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="relative overflow-hidden rounded-xl bg-[var(--ink-900)] p-[24px] text-[#f4f4f5]">
            <div className="mb-[18px] flex items-baseline justify-between font-mono text-[12px] text-[#a1a1aa]">
              <span className="font-medium text-white">SKU 6205-2RS · SKF</span>
              <span>on-stock · 1 280 szt. · WAW-01</span>
            </div>
            <div className="mt-[12px] mb-[16px] font-mono text-[56px] font-semibold leading-none tracking-[-0.03em]">
              <small className="mb-2 block text-[11px] font-medium uppercase tracking-[0.08em] text-[#a1a1aa]">
                NOŚNOŚĆ DYNAMICZNA
              </small>
              14,0 kN
            </div>
            <div className="mb-[24px] flex flex-wrap gap-2">
              {['d 25 mm', 'D 52 mm', 'B 15 mm', '14 000 obr/min', 'ISO 15:2017'].map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/12 bg-white/8 px-[10px] py-[4px] font-mono text-[11px] text-[#e5e7eb]"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                [<DocIcon key="d" />, 'Karta katalogowa', 'PDF · 1,2 MB'],
                [<ShieldIcon key="s" />, 'Certyfikat 3.1', 'EN 10204'],
                [<LayersIcon key="l" />, 'Model 3D STEP', '2,8 MB'],
              ].map(([icon, title, sub]) => (
                <div
                  key={title as string}
                  className="flex items-center gap-2 rounded-sm border border-white/10 bg-white/6 p-[10px]"
                >
                  <div className="inline-flex h-[32px] w-[32px] items-center justify-center rounded-[6px] bg-white/8">
                    {icon}
                  </div>
                  <div>
                    <strong className="block text-[11px] font-medium text-white">{title}</strong>
                    <span className="block font-mono text-[10px] text-[#a1a1aa]">{sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1360px] px-[24px] section">
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
        <div className="grid grid-cols-6 gap-[16px] max-[1100px]:grid-cols-3 max-[600px]:grid-cols-2">
          {categoryTiles.map((c, i) => {
            const glyph = GLYPH_KEYS[i % GLYPH_KEYS.length] as keyof typeof GLYPHS;
            return (
              <Link
                key={c.href}
                href={c.href}
                className="relative block rounded-lg border border-line bg-surface p-[22px] transition hover:-translate-y-[2px] hover:border-[var(--ink-700)]"
              >
                <div className="mb-[14px] inline-flex h-[56px] w-[56px] items-center justify-center rounded-md border border-line bg-surface-alt [&_svg]:h-[36px] [&_svg]:w-[36px]">
                  {GLYPHS[glyph]}
                </div>
                <h3 className="m-0 mb-1 block text-[14px] font-semibold text-fg">{c.name}</h3>
                <span className="font-mono text-[12px] text-muted">
                  {c.count.toLocaleString('pl-PL')} produktów
                </span>
                <span className="absolute right-[22px] top-[22px] text-line-strong">
                  <ArrowUpRightIcon />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-[1360px] px-[24px] section pt-0">
        <div className="grid grid-cols-4 gap-[16px] max-[920px]:grid-cols-2 max-[600px]:grid-cols-1">
          <div className="flex gap-[14px] rounded-lg border border-line bg-surface-alt p-[20px]">
            <div className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border border-line bg-surface text-accent">
              <TruckIcon size={20} />
            </div>
            <div>
              <h4>Wysyłka tego samego dnia</h4>
              <p>Cut-off 14:00. 98,4% pozycji on-stock w magazynie centralnym Warszawa-Okęcie.</p>
            </div>
          </div>
          <div className="flex gap-[14px] rounded-lg border border-line bg-surface-alt p-[20px]">
            <div className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border border-line bg-surface text-accent">
              <WalletIcon size={20} />
            </div>
            <div>
              <h4>Limit kredytowy</h4>
              <p>Od 5 000 do 500 000 PLN. Faktura z odroczonym terminem 14/30/60 dni.</p>
            </div>
          </div>
          <div className="flex gap-[14px] rounded-lg border border-line bg-surface-alt p-[20px]">
            <div className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border border-line bg-surface text-accent">
              <DocIcon size={20} />
            </div>
            <div>
              <h4>Karty katalogowe i CAD</h4>
              <p>Każdy produkt ma kartę PDF, model 3D STEP/DXF, deklarację RoHS.</p>
            </div>
          </div>
          <div className="flex gap-[14px] rounded-lg border border-line bg-surface-alt p-[20px]">
            <div className="inline-flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-md border border-line bg-surface text-accent">
              <SettingsIcon size={20} />
            </div>
            <div>
              <h4>Integracja z ERP</h4>
              <p>API REST, webhooki, eksport CSV/EDI. Quick Order dla 200+ pozycji.</p>
            </div>
          </div>
        </div>
      </section>

      {products.data.length > 0 ? (
        <section className="mx-auto max-w-[1360px] px-[24px] section">
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
          <ul className="m-0 grid list-none grid-cols-4 gap-[16px] p-0 max-[1100px]:grid-cols-2">
            {products.data.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} locale={locale} resolved={bestsellerPrices.get(p.id) ?? null} />
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
  { slug: 'fasteners', name: 'Łączniki', count: 4218 },
  { slug: 'tools', name: 'Narzędzia', count: 2851 },
  { slug: 'electronics', name: 'Elektronika', count: 6104 },
  { slug: 'safety', name: 'BHP', count: 5293 },
  { slug: 'screws', name: 'Wkręty', count: 3162 },
  { slug: 'bolts', name: 'Śruby', count: 1947 },
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
