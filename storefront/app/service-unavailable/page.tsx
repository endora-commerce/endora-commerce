import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { CATALOGUE_LOCALES, tForLocale } from '../../lib/i18n/messages';
import { resolveLocaleWithoutConfig } from '../../lib/i18n/locale';
import { FALLBACK_LOCALE } from '../../lib/i18n/document-locale';
import { UNAVAILABLE_RETRY_HEADER, safeRetryTarget } from '../../lib/service-unavailable';

/**
 * The document a buyer gets when this storefront cannot reach its backend.
 *
 * It is served by the reachability gate in `middleware.ts`, which rewrites here
 * with **`503 Service Unavailable`** and a `Retry-After` — the status is the
 * whole point, and the reasoning for where it is set is in
 * `lib/api/backend-reachability.ts`. The buyer's own URL is unchanged, so the
 * retry below is a retry of the page they asked for.
 *
 * ## It fetches nothing, and that is a constraint rather than a preference
 *
 * Every read on this page would be a read against the backend that is down. So
 * the whole document is composed from the request and the in-tree catalogue: no
 * `getServerContext()`, no chrome, no channel theme, no support address. The
 * root layout takes its bare-document branch for the same reason.
 *
 * That is also the right *design*. During an outage the header's megamenu, cart
 * badge and user pill have no data to render from, and a page that offered
 * links to a catalogue that is equally unreachable would be offering dead text.
 * What is left is what can be honoured: one sentence saying what happened, one
 * saying what has *not* been lost, and one action (Occam's Razor; Law of
 * Prägnanz).
 *
 * ## Accessibility
 *
 * - The state is carried by an icon **and** a word, never by the amber alone
 *   (WCAG 2.2 AA, 1.4.1); the icon is `aria-hidden` because the word beside it
 *   already says it.
 * - There is no auto-refresh. A `<meta http-equiv="refresh">` would move a
 *   reader out from under themselves on a timer they cannot extend or turn off,
 *   which fails SC 2.2.1 (Timing Adjustable). The retry is the buyer's to take.
 * - Nothing on this page changes after it is painted, so it carries no live
 *   region: SC 4.1.3 is about status *changes*, and announcing a static heading
 *   twice is noise.
 * - No animation, so nothing to guard behind `prefers-reduced-motion`.
 */
export const dynamic = 'force-dynamic';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/` FR-010, and
 * `contracts/seo-declarations.md` §2 — silence here is a finding).
 *
 * The reasoning is `app/offline/page.tsx`': a document served *instead of* a
 * page would, if indexed, rank the shop for its own failure state. The `503`
 * says the same thing to a crawler that respects it; this says it to one that
 * only reads the document.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = tForLocale(await outageLocale());
  return {
    title: t('serviceUnavailable.documentTitle'),
    robots: { index: false, follow: false },
  };
}

/**
 * The language to answer in, resolved from the request alone.
 *
 * Shared with the root layout's bare-document branch so `<html lang>` and the
 * words inside it cannot disagree.
 */
export async function outageLocale(): Promise<string> {
  const requestHeaders = await headers();
  return resolveLocaleWithoutConfig({
    acceptLanguage: requestHeaders.get('accept-language'),
    available: CATALOGUE_LOCALES,
    fallback: FALLBACK_LOCALE,
  });
}

export default async function ServiceUnavailablePage(): Promise<ReactNode> {
  const requestHeaders = await headers();
  const t = tForLocale(await outageLocale());
  const retryTarget = safeRetryTarget(requestHeaders.get(UNAVAILABLE_RETRY_HEADER));

  return (
    <section className="mx-auto flex max-w-[1360px] flex-col items-start px-[24px] pb-[96px] pt-[64px]">
      <div className="max-w-[62ch]">
        {/* Icon **and** word: the amber is a second signal, never the only one. */}
        <p className="m-0 inline-flex items-center gap-[8px] rounded-full border border-warn-soft bg-warn-soft px-[10px] py-[6px] font-mono text-[11px] uppercase tracking-[0.08em] text-warn">
          <svg
            aria-hidden="true"
            focusable="false"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          {t('serviceUnavailable.status')}
        </p>

        <h1 className="mb-[12px] mt-[20px] text-[clamp(28px,4vw,40px)] leading-[1.15] tracking-[-0.02em]">
          {t('serviceUnavailable.heading')}
        </h1>

        <p className="m-0 text-[15px] leading-[1.55] text-muted">{t('serviceUnavailable.body')}</p>

        {/* The single primary action in the view (Von Restorff). `min-h` is
            explicit rather than inherited from `.btn--lg`'s padding, because
            Fitts's floor is a measurement and not a side effect of type size. */}
        <p className="m-0 mt-[28px] flex flex-wrap items-center gap-[12px]">
          <a href={retryTarget} className="btn btn--primary btn--lg min-h-[44px]">
            <svg
              aria-hidden="true"
              focusable="false"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
            {t('serviceUnavailable.retry')}
          </a>
          {/* `text-muted`, not `text-subtle`: measured, `--ink-400` on `--bg` is
              2.56:1 in the light token set and fails WCAG 2.2 AA at this size,
              while `--ink-500` is 4.83:1. Both are comfortable in the dark set,
              which is exactly why the light one is the case to check. */}
          <span className="text-[13px] text-muted">{t('serviceUnavailable.retryHint')}</span>
        </p>

        {/* One bounded region for the reassurance, so it reads as a unit rather
            than as a fourth paragraph of the explanation (Law of Common Region).
            This is the "end" of a bad experience and is what the buyer will
            remember of it (Peak-End Rule). */}
        <p className="m-0 mt-[32px] rounded-lg border border-line bg-surface-alt px-[16px] py-[14px] text-[14px] leading-[1.55] text-fg">
          {t('serviceUnavailable.reassurance')}
        </p>
      </div>
    </section>
  );
}
