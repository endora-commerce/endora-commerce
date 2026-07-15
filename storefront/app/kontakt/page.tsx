import type { ReactNode } from 'react';
import { getShopInfo } from '../../lib/api/shop';
import { getServerContext } from '../../lib/server-context';
import { ContactForm } from '../../components/contact/ContactForm';

export const metadata = {
  title: 'Kontakt',
  description: 'Skontaktuj się z nami — formularz kontaktowy.',
};

/**
 * Contact page (feature 049). Renders the contact form (which fires the GA
 * `contact_form_submitted` trigger) alongside the shop's contact details.
 */
export default async function KontaktPage(): Promise<ReactNode> {
  const { ctx } = await getServerContext();
  const shop = await getShopInfo(ctx);

  return (
    <div className="mx-auto max-w-[960px] px-[24px] py-[32px]">
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
