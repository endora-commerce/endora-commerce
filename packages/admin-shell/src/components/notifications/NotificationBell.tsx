import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useTranslationContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cn } from '@endora-commerce/admin-kit/lib';
import { Button } from '@endora-commerce/admin-kit/ui';
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
 */
export function NotificationBell(): ReactElement {
  const t = useTranslation('core');
  const bundles = useTranslationContext();
  const navigate = useNavigate();
  const { items, unreadCount, refresh, markRead, markAllRead } = useAdminNotifications();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (
        target &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return (): void => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return (): void => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleClick = (entry: AdminNotificationItem): void => {
    void markRead(entry.id);
    if (entry.linkPath) navigate(entry.linkPath);
    setOpen(false);
  };

  const badge = formatUnreadBadge(unreadCount);
  const buttonName =
    unreadCount > 0
      ? t('appShell.topbar.notificationsUnread', { count: unreadCount })
      : t('appShell.topbar.notifications');

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="b2b-topbar__icon-btn"
        title={buttonName}
        aria-label={buttonName}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(): void => {
          if (!open) void refresh();
          setOpen((v) => !v);
        }}
      >
        <Bell size={16} />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-destructive px-[5px] py-0.5 text-center text-[10px] font-semibold leading-none text-destructive-foreground"
          >
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          ref={dropdownRef}
          role="menu"
          aria-label={t('appShell.notifications.title')}
          className="absolute right-0 top-[calc(100%+6px)] z-[100] w-[340px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-3.5 py-2">
            <strong className="text-sm">{t('appShell.notifications.title')}</strong>
            {unreadCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground"
                onClick={(): void => void markAllRead()}
              >
                <CheckCheck aria-hidden="true" />
                {t('appShell.notifications.markAllRead')}
              </Button>
            ) : null}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <p className="m-0 px-3.5 py-6 text-center text-[13px] text-muted-foreground">
                {t('appShell.notifications.empty')}
              </p>
            ) : (
              items.map((it) => {
                const body = notificationText(bundles, it.bodyMessage, it.body);
                return (
                  <button
                    key={it.id}
                    type="button"
                    role="menuitem"
                    className={cn(
                      'block w-full border-b border-l-[3px] border-b-border py-2.5 pl-[11px] pr-3.5 text-left text-sm',
                      'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                      it.isRead ? 'border-l-transparent' : 'border-l-primary',
                    )}
                    onClick={(): void => handleClick(it)}
                  >
                    <div className="flex justify-between gap-2">
                      <span className={cn('flex-1', it.isRead ? 'font-normal' : 'font-semibold')}>
                        {it.isRead ? null : (
                          <span className="sr-only">{t('appShell.notifications.unread')} </span>
                        )}
                        {notificationText(bundles, it.titleMessage, it.title)}
                      </span>
                      <time className="text-[11px] text-muted-foreground" dateTime={it.createdAt}>
                        {formatRelative(it.createdAt, bundles.language)}
                      </time>
                    </div>
                    {body ? <div className="mt-0.5 text-xs text-muted-foreground">{body}</div> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
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
