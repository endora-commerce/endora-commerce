import { useId, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useTranslationContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cn } from '@endora-commerce/admin-kit/lib';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@endora-commerce/admin-kit/ui';
import { notificationText } from './notification-text.js';
import { useAdminNotifications, type AdminNotificationItem } from './useAdminNotifications.js';

/**
 * Admin notification bell — toolbar button in the top-nav.
 *
 * Polls the feed every 30 s via `useAdminNotifications`. Shows an unread
 * badge ("3", "9+", or none) and a dropdown listing the 25 most-recent
 * entries (unread-first via the server-side ordering). Clicking a row
 * marks it read and navigates to `linkPath` if present. "Mark all read"
 * acts on the visible-to-this-admin set (broadcasts insert a per-admin
 * read cursor; per-admin entries flip `read_at` directly).
 *
 * An entry's title and body are drawn in the reader's language when the entry
 * carries a message for them, and as recorded when it does not — see
 * `notificationText`.
 *
 * The panel is the kit's `DropdownMenu` (issue #1783): it opens with focus
 * inside, walks its entries with the arrow keys and Home/End, jumps to a row by
 * its title's first letters, and gives focus back to the bell on Escape — the
 * contract of every other admin menu (Jakob's Law). It is portalled, so no
 * page container can clip it.
 */
export function NotificationBell(): ReactElement {
  const t = useTranslation('core');
  const bundles = useTranslationContext();
  const navigate = useNavigate();
  const { items, unreadCount, refresh, markRead, markAllRead } = useAdminNotifications();
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const onOpenChange = (next: boolean): void => {
    if (next) void refresh();
    setOpen(next);
  };

  const handleSelect = (entry: AdminNotificationItem): void => {
    void markRead(entry.id);
    if (entry.linkPath) navigate(entry.linkPath);
  };

  const badge = formatUnreadBadge(unreadCount);
  const buttonName =
    unreadCount > 0
      ? t('appShell.topbar.notificationsUnread', { count: unreadCount })
      : t('appShell.topbar.notifications');

  return (
    <div className="relative">
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="b2b-topbar__icon-btn" title={buttonName} aria-label={buttonName}>
            {/*
              The badge hangs off the icon, not off the button's corner, so it
              keeps its place when a coarse pointer grows the button to 44 px
              (#1784).
            */}
            <span className="relative inline-flex">
              <Bell size={16} aria-hidden="true" />
              {badge ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-2 -top-2 min-w-4 rounded-full bg-destructive px-[5px] py-0.5 text-center text-[10px] font-semibold leading-none text-destructive-foreground"
                >
                  {badge}
                </span>
              ) : null}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          // Named by its visible heading; Radix would otherwise borrow the
          // trigger's name, unread count included.
          aria-labelledby={titleId}
          sideOffset={6}
          className="w-[340px] max-w-[calc(100vw-24px)] rounded-lg p-0 shadow-lg"
        >
          <div className="border-b border-border bg-muted px-3.5 py-1.5">
            <DropdownMenuLabel id={titleId} className="p-0 text-sm font-semibold text-foreground">
              {t('appShell.notifications.title')}
            </DropdownMenuLabel>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <p className="m-0 px-3.5 py-6 text-center text-[13px] text-muted-foreground">
                {t('appShell.notifications.empty')}
              </p>
            ) : (
              items.map((it) => {
                const title = notificationText(bundles, it.titleMessage, it.title);
                const body = notificationText(bundles, it.bodyMessage, it.body);
                return (
                  <DropdownMenuItem
                    key={it.id}
                    // Type-ahead matches the title, not the screen-reader "Unread" before it.
                    textValue={title}
                    className={cn(
                      'block rounded-none border-b border-l-[3px] border-b-border py-2.5 pl-[11px] pr-3.5',
                      it.isRead ? 'border-l-transparent' : 'border-l-primary',
                    )}
                    onSelect={(): void => handleSelect(it)}
                  >
                    <div className="flex justify-between gap-2">
                      <span className={cn('flex-1', it.isRead ? 'font-normal' : 'font-semibold')}>
                        {it.isRead ? null : (
                          <span className="sr-only">{t('appShell.notifications.unread')} </span>
                        )}
                        {title}
                      </span>
                      <time className="text-[11px] text-muted-foreground" dateTime={it.createdAt}>
                        {formatRelative(it.createdAt, bundles.language)}
                      </time>
                    </div>
                    {body ? <div className="mt-0.5 text-xs text-muted-foreground">{body}</div> : null}
                  </DropdownMenuItem>
                );
              })
            )}
          </div>
          {unreadCount > 0 ? (
            <>
              <DropdownMenuSeparator className="m-0" />
              {/*
                The footer, not the header: as the last entry, focus opening
                the bell with Enter lands on the newest notification, so a
                second Enter cannot wipe the unread state; End reaches it.
              */}
              <DropdownMenuItem
                className="m-1 justify-center text-xs font-medium text-muted-foreground"
                // Marking all read keeps the panel open, so the rows losing
                // their unread mark is seen where it was asked for.
                onSelect={(event): void => {
                  event.preventDefault();
                  void markAllRead();
                }}
              >
                <CheckCheck aria-hidden="true" />
                {t('appShell.notifications.markAllRead')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function formatUnreadBadge(n: number): string | null {
  if (n <= 0) return null;
  if (n > 9) return '9+';
  return String(n);
}

/**
 * How long ago an entry was written, in the reader's language and the narrow
 * form the row has room for ("5m ago", "5 min temu"). Under a minute it is
 * "now" ("teraz"); beyond that the count is always a number, so a Polish reader
 * sees "2 dni temu" rather than "przedwczoraj" next to "3 dni temu".
 */
export function formatRelative(iso: string, language: string, now: number = Date.now()): string {
  const diffMin = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) {
    return new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'narrow' }).format(0, 'second');
  }
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'always', style: 'narrow' });
  if (diffMin < 60) return format.format(-diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return format.format(-diffHr, 'hour');
  return format.format(-Math.round(diffHr / 24), 'day');
}
