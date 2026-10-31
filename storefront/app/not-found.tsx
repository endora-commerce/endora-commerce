import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getCategoryTree } from '../lib/api/catalog';
import { getShopInfo } from '../lib/api/shop';
import { getServerContext } from '../lib/server-context';
import { LocalizedLink, LocalizedForm } from '../lib/i18n/localized-link';
import { tForLocale, type MessageKey } from '../lib/i18n/messages';
import { format } from '../lib/i18n/format';
import { productCountLabel } from '../lib/i18n/chrome-counts';

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  return {
    title: format(t('chrome.notFound.documentTitle'), { site: t('chrome.layout.title') }),
    robots: { index: false, follow: false },
  };
}

interface PopularCategory {
  slug: string;
  name: string;
  count: number;
}

const FALLBACK_CATEGORIES: ReadonlyArray<{ slug: string; nameKey: MessageKey; count: number }> = [
  { slug: 'fasteners', nameKey: 'chrome.shared.category.fasteners', count: 4218 },
  { slug: 'tools', nameKey: 'chrome.shared.category.tools', count: 2851 },
  { slug: 'electronics', nameKey: 'chrome.shared.category.electronics', count: 6104 },
  { slug: 'safety', nameKey: 'chrome.shared.category.safety', count: 5293 },
  { slug: 'screws', nameKey: 'chrome.shared.category.screws', count: 3162 },
  { slug: 'bolts', nameKey: 'chrome.shared.category.bolts', count: 1947 },
];

export default async function NotFound(): Promise<ReactNode> {
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  const [tree, shop] = await Promise.all([
    getCategoryTree(ctx).catch(
      () => [] as Awaited<ReturnType<typeof getCategoryTree>>,
    ),
    getShopInfo(ctx),
  ]);
  const popular: PopularCategory[] =
    tree.length > 0
      ? tree.slice(0, 6).map((c) => ({ slug: c.slug, name: c.name, count: c.productCount }))
      : FALLBACK_CATEGORIES.map((c) => ({ slug: c.slug, name: t(c.nameKey), count: c.count }));

  // Support contact lines are settings-driven (Settings → Shop information).
  // Prefer the dedicated support address, fall back to the main contact email.
  const supportEmail = shop.supportEmail || shop.contactEmail;
  const phone = shop.phone;
  const hasHelpContact = supportEmail !== '' || phone !== '';

  return (
    <section className="mx-auto max-w-[1360px] px-[24px] section pt-[48px] pb-[80px]">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-[40px] min-[960px]:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)] min-[960px]:gap-[56px]">
        <div className="max-w-[720px]">
          <span className="inline-flex items-center gap-[8px] rounded-full border border-line bg-surface-alt px-[10px] py-[6px] font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
            <span className="inline-block h-[6px] w-[6px] rounded-full bg-bad shadow-[0_0_0_3px_rgba(185,28,28,0.12)]" />{' '}
            {t('chrome.notFound.status')}
          </span>
          <div
            className="mb-[12px] mt-[20px] bg-linear-to-b from-fg to-muted bg-clip-text font-mono text-[clamp(96px,18vw,192px)] font-semibold leading-[0.92] tracking-[-0.04em] text-transparent"
            aria-hidden="true"
          >
            404
          </div>
          <h1 className="mb-[12px] text-[clamp(28px,4vw,40px)] leading-[1.1] tracking-[-0.02em]">
            {t('chrome.notFound.heading')}
          </h1>
          <p className="mb-[28px] max-w-[56ch] text-[15px] leading-[1.55] text-muted">
            {t('chrome.notFound.body')}
          </p>

          <LocalizedForm
            action="/catalog"
            method="get"
            className="mb-[24px] flex max-w-[560px] items-stretch gap-[8px]"
            role="search"
          >
            <label htmlFor="not-found-q" className="sr-only">
              {t('chrome.notFound.searchLabel')}
            </label>
            <input
              id="not-found-q"
              name="q"
              type="search"
              placeholder={t('chrome.notFound.searchPlaceholder')}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-[14px] py-[12px] text-fg placeholder:text-subtle"
            />
            <button type="submit" className="btn btn--primary btn--lg">
              {t('common.searchAction')}
            </button>
          </LocalizedForm>

          <div className="flex flex-wrap gap-[10px]">
            <LocalizedLink href="/" className="btn btn--dark btn--lg">
              {t('chrome.notFound.home')}
            </LocalizedLink>
            <LocalizedLink href="/catalog" className="btn btn--outline btn--lg">
              {t('chrome.shared.browseCatalog')}
            </LocalizedLink>
            <LocalizedLink href="/quote-request" className="btn btn--ghost btn--lg">
              {t('chrome.notFound.quoteRequest')}
            </LocalizedLink>
          </div>
        </div>

        <aside
          className="rounded-lg border border-line bg-surface p-[20px] shadow-sm"
          aria-label={t('chrome.notFound.popularLabel')}
        >
          <h2 className="mb-[14px] font-mono text-[14px] uppercase tracking-[0.06em] text-muted">
            {t('chrome.notFound.popularHeading')}
          </h2>
          <ul className="m-0 mb-[20px] flex list-none flex-col gap-[2px] p-0">
            {popular.map((c) => (
              <li key={c.slug}>
                <LocalizedLink
                  href={`/c/${c.slug}`}
                  className="-mx-[12px] flex items-baseline justify-between gap-[12px] rounded-md px-[12px] py-[10px] text-fg transition-colors hover:bg-surface-alt hover:text-accent"
                >
                  <span className="font-medium">{c.name}</span>
                  <em className="whitespace-nowrap font-mono text-[11px] not-italic text-muted">
                    {productCountLabel(c.count, locale)}
                  </em>
                </LocalizedLink>
              </li>
            ))}
          </ul>

          {hasHelpContact ? (
            <div className="border-t border-line pt-[16px]">
              <h3 className="mb-[10px] font-mono text-[14px] uppercase tracking-[0.06em] text-muted">
                {t('chrome.notFound.help')}
              </h3>
              {supportEmail !== '' ? (
                <p className="my-[4px] text-[13px]">
                  <a
                    href={`mailto:${supportEmail}`}
                    className="font-medium text-fg hover:text-accent"
                  >
                    {supportEmail}
                  </a>
                </p>
              ) : null}
              {phone !== '' ? (
                <p className="my-[4px] text-[13px]">
                  <a
                    href={`tel:${phone.replace(/\s+/g, '')}`}
                    className="font-medium text-fg hover:text-accent"
                  >
                    {phone}
                  </a>
                </p>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
