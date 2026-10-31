import type { ReactNode } from 'react';
import type { SalesChannelAccessResponse } from '@endora-commerce/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { pickLocalizedString } from '../lib/i18n/locale';
import { SignOutButton } from './account/SignOutButton';

/**
 * The screen a signed-in buyer sees on a store their account may not use
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §4, FR-029).
 *
 * Rendered by the root layout in place of the page, inside the store's chrome,
 * when the backend answers the buyer's identity read with
 * `SALES_CHANNEL_NOT_PERMITTED`. Not a redirect: every page of this store would
 * redirect again, and the sign-in page cannot help a buyer who is signed in.
 *
 * It answers three questions and offers one way out (Hick's Law): what
 * happened, where the buyer can shop instead — the stores their Organization
 * may use, linked when the operator gave the store an address — and whom to
 * ask. Signing out is the one action, for a buyer who meant to use another
 * account here. The list is left out when there is nothing to list, rather than
 * shown empty (Signal-to-Noise).
 *
 * `200` with `noindex`: an App Router layout cannot set the status, and the
 * screen is about one buyer, not about the store a crawler would index.
 */
export function ChannelAccessDenied({
  locale,
  access,
  signOut,
}: {
  locale: string;
  /** The viewer's access answer, or `null` when it could not be read. */
  access: SalesChannelAccessResponse['data'] | null;
  signOut: () => Promise<void>;
}): ReactNode {
  const t = tForLocale(locale);
  const stores = access?.permittedChannels ?? [];

  return (
    <section className="mx-auto flex max-w-[1360px] flex-col items-start px-[24px] pb-[96px] pt-[64px]">
      <meta name="robots" content="noindex, nofollow" />
      <div className="max-w-[62ch]">
        <h1 className="mb-[12px] mt-0 text-[clamp(28px,4vw,40px)] leading-[1.15] tracking-[-0.02em]">
          {t('access.denied.title')}
        </h1>
        <p className="m-0 text-[15px] leading-[1.55] text-muted">{t('access.denied.body')}</p>

        {stores.length > 0 ? (
          <div className="mt-[28px]">
            <h2 className="m-0 text-[15px] font-medium">{t('access.denied.otherStores')}</h2>
            <ul className="m-0 mt-[12px] flex list-none flex-col gap-[8px] p-0">
              {stores.map((store) => {
                // A channel's name is kept per language; the code is the last resort.
                const name = pickLocalizedString(store.name, locale) || store.code;
                return (
                  <li key={store.code} className="text-[15px] leading-[1.55]">
                    {store.storefrontUrl !== null ? (
                      <a
                        href={store.storefrontUrl}
                        className="inline-flex min-h-[44px] items-center underline underline-offset-[3px]"
                      >
                        {name}
                      </a>
                    ) : (
                      <span className="inline-flex min-h-[44px] items-center">{name}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <p className="m-0 mt-[28px] text-[13px] leading-[1.55] text-muted">{t('access.denied.contact')}</p>

        <div className="mt-[20px]">
          <SignOutButton
            signOut={signOut}
            locale={locale}
            label={t('access.denied.signOut')}
            className="btn btn--outline min-h-[44px]"
          />
        </div>
      </div>
    </section>
  );
}
