import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getShopInfo } from '../../lib/api/shop';
import { getServerContext } from '../../lib/server-context';
import { ContactForm } from '../../components/contact/ContactForm';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { tForLocale } from '../../lib/i18n/messages';
import { seo } from './seo';

/**
 * Indexable (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010/FR-012).
 */
export const metadata: Metadata = {
  title: 'Kontakt',
  description: 'Skontaktuj się z nami — formularz kontaktowy.',
  alternates: { canonical: seo.route },
};

/**
 * Contact page (feature 049). Renders the contact form (which fires the GA
 * `contact_form_submitted` trigger) alongside the shop's contact details.
 */
export default async function KontaktPage(): Promise<ReactNode> {
  const { ctx, locale } = await getServerContext();
  const shop = await getShopInfo(ctx);
  const t = tForLocale(locale);

  return (
    <div className="mx-auto max-w-[960px] px-[24px] py-[32px]">
      {/*
        The trail is the page's `BreadcrumbList` emitter as well as its
        navigation: `Breadcrumbs` renders the JSON-LD itself, so declaring the
        type in `seo.ts` and rendering the component are one change, not two.
      */}
      <Breadcrumbs
        crumbs={[
          { href: '/', label: t('nav.home') },
          { href: '/kontakt', label: 'Kontakt' },
        ]}
      />
      <h1 className="text-[28px] font-semibold">Kontakt</h1>
      <p className="mt-2 text-[15px] text-muted">
        Masz pytanie? Wypełnij formularz — odpowiemy najszybciej, jak to możliwe.
      </p>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_280px]">
        <ContactForm />

        <aside className="flex flex-col gap-3 text-[14px]">
          {shop.name ? <div className="font-semibold">{shop.name}</div> : null}
          {shop.address ? <div className="text-muted">{shop.address}</div> : null}
          {shop.contactEmail ? (
            <div>
              E-mail: <a className="underline" href={`mailto:${shop.contactEmail}`}>{shop.contactEmail}</a>
            </div>
          ) : null}
          {shop.phone ? (
            <div>
              Tel.: <a className="underline" href={`tel:${shop.phone}`}>{shop.phone}</a>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
