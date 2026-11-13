import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CustomerNotification } from '@endora-commerce/contracts';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { getMe } from '../../../../lib/api/account';
import { StorefrontApiError } from '../../../../lib/api/client';
import {
  listCustomerNotifications,
  type CustomerNotificationPage,
} from '../../../../lib/api/customer-notifications';
import { fetchPwaConfig } from '../../../../lib/api/pwa-server';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { tForLocale } from '../../../../lib/i18n/messages';
import { CartSubmitButton } from '../../../../components/CartSubmitButton';
import { Pagination } from '../../../../components/Pagination';
import { FocusOnMount } from '../../../../components/account/FocusOnMount';
import { markAllReadAction, markReadAction } from './actions';

/** Not indexed: one buyer's own record (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

const HEADING_ID = 'notifications-heading';
const IMPERSONATING_ID = 'notifications-impersonating';
/** Under this age a date reads relatively ("2 h ago"), from it absolutely. */
const RELATIVE_FOR_MS = 7 * 24 * 3_600_000;

/**
 * The customer notification centre (`specs/179-rfq-and-customer-notifications/`
 * US3, FR-050 – FR-052, `contracts/customer-notifications-storefront-api.md` §3).
 *
 * Newest first, 20 to a page, paged with the shared `Pagination` ("Show
 * older"). An entry with a link is one link to its open route, which marks it
 * read and lands on the request; an entry without one offers *Mark as read*.
 * Unread is said in text ("New") and weight, not colour alone. Beside the
 * heading an always-rendered status region announces *Mark all as read*, after
 * which focus moves to the heading.
 *
 * While the module is off the page is the shop's 404 (FR-048); page loads use
 * the root layout's `NavigationFeedback`, so there is no `loading.tsx`.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; marked?: string; markError?: string }>;
}): Promise<ReactNode> {
  const { locale, ctx, modules } = await getServerContext();
  if (!modules.isPresent('customer_notifications')) notFound();
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/notifications');
  const sp = await searchParams;
  const cursor = sp.cursor || null;
  const t = tForLocale(locale);

  const [me, list, pwaConfig] = await Promise.all([
    getMe(session),
    listCustomerNotifications(session, ctx, { cursor }).catch((err: unknown) => err),
    modules.isPresent('pwa') ? fetchPwaConfig(ctx.salesChannelCode) : Promise.resolve(null),
  ]);
  if (list instanceof StorefrontApiError && list.code === 'MODULE_DISABLED') notFound();
  const impersonating = me.impersonation !== null;
  const marked = sp.marked === 'all';

  const head = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={HEADING_ID} tabIndex={-1} className="focus:outline-none">
        {t('account.notifications.heading')}
      </h2>
      <div role="status" className="text-[13px] text-muted">{marked ? t('account.notifications.allMarked') : ''}</div>
      {marked ? <FocusOnMount targetId={HEADING_ID} /> : null}
    </div>
  );

  if (!isPage(list)) {
    return (
      <>
        {head}
        <div role="alert" className="mt-4 grid gap-2">
          <p className="m-0">{t('account.notifications.loadError')}</p>
          <p className="m-0">
            <LocalizedLink href="/account/notifications" className="btn btn--outline btn--sm min-h-[44px]">
              {t('account.notifications.retry')}
            </LocalizedLink>
          </p>
        </div>
      </>
    );
  }

  const offersPush = pwaConfig?.pushEnabled === true;
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const now = Date.now();

  return (
    <>
      {head}
      {impersonating ? (
        <p id={IMPERSONATING_ID} className="mt-2 text-[13px] text-muted">
          {t('account.notifications.impersonating')}
        </p>
      ) : null}
      {sp.markError === '1' ? (
        <p role="alert" className="mt-3 rounded-sm border border-line bg-surface-alt px-[12px] py-[8px] text-[13px]">
          {t('account.notifications.markError')}
        </p>
      ) : null}
      {list.unreadCount > 0 ? (
        <form action={markAllReadAction} className="mt-3">
          {impersonating ? (
            <button
              type="button"
              className="btn btn--outline btn--sm min-h-[44px] w-full justify-center whitespace-normal min-[400px]:w-auto"
              disabled
              aria-describedby={IMPERSONATING_ID}
            >
              {t('account.notifications.markAllRead')}
            </button>
          ) : (
            <CartSubmitButton
              className="btn btn--outline btn--sm min-h-[44px] w-full justify-center whitespace-normal min-[400px]:w-auto"
              label={t('account.notifications.markAllRead')}
              pendingLabel={t('account.notifications.marking')}
            />
          )}
        </form>
      ) : null}

      {list.items.length === 0 ? (
        <div className="mt-6 grid justify-items-start gap-3">
          <BellIcon />
          <p className="m-0">{t('account.notifications.empty')}</p>
          {modules.isPresent('quote_requests') && me.organization ? (
            <LocalizedLink href="/quote-requests" className="btn btn--outline btn--sm min-h-[44px]">
              {t('account.notifications.goToQuoteRequests')}
            </LocalizedLink>
          ) : null}
        </div>
      ) : (
        <ul className="mt-4 grid list-none gap-[2px] p-0">
          {list.items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              cursor={cursor}
              impersonating={impersonating}
              date={dateOf(item.createdAt, now, locale, relative)}
              t={t}
            />
          ))}
        </ul>
      )}

      <Pagination
        basePath="/account/notifications"
        baseQuery={{}}
        nextCursor={list.nextCursor}
        hasMore={list.nextCursor !== null}
        locale={locale}
        label={t('account.notifications.showOlder')}
      />

      {offersPush ? (
        <p className="mt-6 text-[13px]">
          <LocalizedLink href="/account#push-section-heading" className="text-fg-soft underline">
            {t('account.notifications.managePush')}
          </LocalizedLink>
        </p>
      ) : null}
    </>
  );
}

function isPage(value: unknown): value is CustomerNotificationPage {
  return typeof value === 'object' && value !== null && Array.isArray((value as CustomerNotificationPage).items);
}

function NotificationRow({
  item,
  cursor,
  impersonating,
  date,
  t,
}: {
  item: CustomerNotification;
  cursor: string | null;
  impersonating: boolean;
  date: string;
  t: ReturnType<typeof tForLocale>;
}): ReactNode {
  const unread = item.readAt === null;
  const content = (
    <>
      {/* Takes the row; under ~14rem left beside the button, the button wraps below it. */}
      <span className="grid min-w-0 flex-1 basis-[14rem] gap-[2px]">
        <span className={unread ? 'font-semibold text-fg' : 'text-fg'}>
          {unread ? (
            <span className="mr-2 inline-block rounded-sm bg-accent px-[6px] text-[11px] font-semibold uppercase tracking-[0.04em] text-white">
              {t('account.notifications.new')}
            </span>
          ) : null}
          {item.title}
        </span>
        {item.body ? <span className="text-[13px] text-fg-soft">{item.body}</span> : null}
        {/* `text-muted` on the unread tint is 4.4:1, under the 4.5:1 floor; `text-fg-soft` is 9.6:1. */}
        <time dateTime={item.createdAt} className={`text-[12px] ${unread ? 'text-fg-soft' : 'text-muted'}`}>
          {date}
        </time>
      </span>
    </>
  );
  const surface = `flex min-h-[44px] flex-wrap items-center justify-between gap-3 rounded-sm px-[12px] py-[10px] ${
    // `--brand-50` is not re-tinted in the dark scope, where the row's light text would sit on it.
    unread ? 'bg-accent-soft dark:bg-surface-alt' : ''
  }`;

  return (
    <li data-notification-id={item.id}>
      {item.linkPath ? (
        <LocalizedLink
          href={`/account/notifications/${item.id}/open`}
          prefetch={false}
          className={`${surface} hover:bg-surface-alt`}
        >
          {content}
        </LocalizedLink>
      ) : (
        <div className={surface}>
          {content}
          {unread ? (
            <form action={markReadAction} className="shrink-0">
              <input type="hidden" name="id" value={item.id} />
              {cursor ? <input type="hidden" name="cursor" value={cursor} /> : null}
              {impersonating ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm min-h-[44px] whitespace-normal"
                  disabled
                  aria-describedby={IMPERSONATING_ID}
                >
                  {t('account.notifications.markRead')}
                </button>
              ) : (
                <CartSubmitButton
                  className="btn btn--ghost btn--sm min-h-[44px] whitespace-normal"
                  label={t('account.notifications.markRead')}
                  pendingLabel={t('account.notifications.marking')}
                />
              )}
            </form>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** "2 hr. ago" under seven days, the date in the reader's format from then on. */
function dateOf(iso: string, now: number, locale: string, relative: Intl.RelativeTimeFormat): string {
  const at = new Date(iso);
  const age = now - at.getTime();
  if (age >= RELATIVE_FOR_MS || age < 0) return at.toLocaleDateString(locale);
  const minutes = Math.floor(age / 60_000);
  if (minutes < 60) return relative.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, 'hour');
  return relative.format(-Math.floor(hours / 24), 'day');
}

function BellIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="text-muted"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
