import type { ReactNode } from 'react';
import { LocalizedAnchor, LocalizedForm } from '../lib/i18n/localized-link';
import { tForLocale } from '../lib/i18n/messages';
import { format } from '../lib/i18n/format';
import { REFERENCE_BRAND_MARK, REFERENCE_BRAND_NAME } from '../lib/theme/reference-brand';

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

/**
 * Where the "Built with … Endora Commerce" credit points. The UTM parameters
 * are what lets the product site's analytics tell a click on this footer link
 * from any other referral: `utm_content=footer` names the placement, and the
 * other three name the kind of visit.
 */
export const BUILT_WITH_URL =
  'https://commerce.endora.software/?utm_source=storefront&utm_medium=referral&utm_campaign=built-with&utm_content=footer';

/**
 * The Endora Commerce mark on its white tile — the artwork of
 * `docs/static/img/logo.svg`, inlined so the footer costs no request for it.
 * The tile is part of the artwork: the footer is dark in both themes, and the
 * mark's purple needs a light ground. Decorative here, since the product name
 * is written beside it.
 */
function EndoraCommerceMark(props: { className?: string }): ReactNode {
  return (
    <svg
      className={props.className}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="40" height="40" rx="9" fill="#fff" />
      <g transform="translate(7.03 5) scale(0.021172)">
        <g transform="translate(-70 -123)" fill="#6322C8">
          <path d="M172 123A65 65 0 0 0 107 188A65 65 0 0 0 172 253L769.99609 253L770 253C972.77803 253.01228 1141.3628 405.91574 1161.1094 607.73047L1161.1094 607.73242L1161.1094 607.73438C1170.8199 706.90026 1094.6421 790.90206 995.00195 790.90039L995 790.90039L904 790.90039L904 920.90039L994.99805 920.90039C1169.3725 920.90339 1307.4806 768.61427 1290.4902 595.07031L1290.4902 595.06445C1264.3364 327.79641 1038.5492 123.01364 770.00391 123A65 65 0 0 0 770 123L172 123z" />
          <path d="m388.92578,509.11523c-119.397,-2.62101-230.13527,63.43203-284.5625,169.73438-54.427232,106.30235-43.277539,234.76053 28.64844,330.09769l0.0312,0.043 313.5332,414.1446c52.09015,68.8542 132.14453,111.1165 218.38281,115.289h0.006 0.006c284.3908,13.7094 542.6296,-167.5765 626.3555,-439.709l-124.252,-38.2285c-66.4518,215.9869-270.11667,358.9654-495.83201,348.0899-47.85038,-2.3152-92.10262,-25.6788-121.00196,-63.8867l-0.008,-0.012-313.44336,-414.02536-0.008,-0.01C194.69288,874.84699 188.22613,800.30613 220.07812,738.0957c31.8539,-62.21415 96.11821,-100.54568 165.9961,-99.01172z" />
          <path d="m356,725.5a65,65 0 0 0-65,65 65,65 0 0 0 65,65h302a65,65 0 0 0 65,-65 65,65 0 0 0-65,-65z" />
        </g>
        <circle cx="127.5" cy="1313.5" r="92" fill="#1A1226" />
      </g>
    </svg>
  );
}

export function Footer(props: {
  /** The page's locale; the footer's copy is rendered in it. */
  locale: string;
  cmsLinks?: Array<{ path: string; title: string }>;
  top?: ReactNode;
  bottom?: ReactNode;
  copyright?: ReactNode;
}): ReactNode {
  const t = tForLocale(props.locale);
  const supportLinks = props.cmsLinks && props.cmsLinks.length > 0
    ? props.cmsLinks
    : [
        { path: 'kontakt', title: t('chrome.footer.support.contact') },
        { path: 'reklamacje', title: t('chrome.footer.support.returns') },
        { path: 'dostawa', title: t('chrome.footer.support.delivery') },
        { path: 'certyfikaty', title: t('chrome.footer.support.certificates') },
        { path: 'pomoc', title: t('chrome.footer.support.help') },
      ];
  const [builtWithBefore, builtWithAfter] = t('chrome.footer.builtWith').split('{heart}');

  return (
    <footer className="mt-[64px] bg-[#18181b] pt-[56px] pb-[28px] text-[#d4d4d8] dark:bg-[#050507]">
      <div className="mx-auto max-w-[1360px] px-[24px]">
        {props.top}
        <div className="grid grid-cols-[2fr_repeat(4,1fr)] gap-8 border-b border-white/8 pb-9 max-[920px]:grid-cols-2">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="industria-header__mark bg-white text-[var(--ink-900)]">{REFERENCE_BRAND_MARK}</span>
              <strong className="text-[16px] text-white">{REFERENCE_BRAND_NAME}</strong>
            </div>
            <p className="mt-[14px] max-w-[280px] leading-[1.5] text-[#a1a1aa]">
              {t('chrome.footer.about')}
            </p>
          </div>

          <div>
            <h5 className={COL_HEADING}>{t('chrome.footer.shop')}</h5>
            <LocalizedAnchor className={COL_LINK} href="/catalog">{t('nav.catalog')}</LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/c/fasteners">
              {t('chrome.shared.category.fasteners')}
            </LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/c/tools">{t('chrome.shared.category.tools')}</LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/c/electronics">
              {t('chrome.shared.category.electronics')}
            </LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/c/safety">{t('chrome.shared.category.safety')}</LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/quick-order">{t('nav.quickOrder')}</LocalizedAnchor>
          </div>

          <div>
            <h5 className={COL_HEADING}>{t('chrome.footer.account')}</h5>
            <LocalizedAnchor className={COL_LINK} href="/account">{t('chrome.footer.myAccount')}</LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/orders">{t('chrome.footer.orders')}</LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/invoices">{t('chrome.footer.invoices')}</LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/quote-requests">
              {t('chrome.footer.quoteRequests')}
            </LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/shopping-lists">
              {t('chrome.footer.shoppingLists')}
            </LocalizedAnchor>
            <LocalizedAnchor className={COL_LINK} href="/credit-limit">{t('chrome.shared.creditLimit')}</LocalizedAnchor>
          </div>

          <div>
            <h5 className={COL_HEADING}>{t('chrome.footer.support')}</h5>
            {supportLinks.map((l) => (
              <LocalizedAnchor key={l.path} className={COL_LINK} href={`/${l.path}`}>
                {l.title}
              </LocalizedAnchor>
            ))}
          </div>

          <div>
            <h5 className={COL_HEADING}>{t('chrome.footer.newsletter.heading')}</h5>
            <p className="mb-3 text-[12px] text-[#a1a1aa]">{t('chrome.footer.newsletter.intro')}</p>
            <LocalizedForm action="/newsletter" method="POST">
              <input
                className="mb-2 w-full rounded-md border border-white/12 bg-white/4 px-2.5 py-2 text-[13px] text-white placeholder:text-[#71717a]"
                type="email"
                name="email"
                placeholder={t('chrome.footer.newsletter.placeholder')}
                required
              />
              <button type="submit" className="btn btn--primary btn--block btn--sm">
                {t('chrome.footer.newsletter.submit')}
              </button>
            </LocalizedForm>
          </div>
        </div>

        {props.bottom}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-[22px] text-[12px] text-[#71717a]">
          <span>{format(t('chrome.footer.legal'), { year: String(new Date().getFullYear()) })}</span>
          {props.copyright}
          <span className="inline-flex gap-4">
            <LocalizedAnchor className="text-[#a1a1aa] hover:text-white" href="/regulamin">
              {t('chrome.footer.terms')}
            </LocalizedAnchor>
            <LocalizedAnchor className="text-[#a1a1aa] hover:text-white" href="/polityka-prywatnosci">
              {t('chrome.footer.privacy')}
            </LocalizedAnchor>
            <LocalizedAnchor className="text-[#a1a1aa] hover:text-white" href="/cookies">
              {t('chrome.footer.cookies')}
            </LocalizedAnchor>
          </span>
        </div>

        <p className="mt-[22px] flex flex-wrap items-center justify-center gap-x-2.5 gap-y-2 border-t border-white/8 pt-[22px] text-[12px] text-[#71717a]">
          <span>
            {builtWithBefore}
            <span aria-hidden="true">❤️</span>
            {builtWithAfter}
          </span>
          <a
            className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#d4d4d8] hover:text-white"
            href={BUILT_WITH_URL}
            target="_blank"
            rel="noopener"
          >
            <EndoraCommerceMark className="h-7 w-7 shrink-0" />
            {t('chrome.footer.builtWithProduct')}
          </a>
        </p>
      </div>
    </footer>
  );
}
