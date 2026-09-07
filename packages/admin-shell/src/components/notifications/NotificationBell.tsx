import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useTranslation } from '../../i18n/useTranslation.js';
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
 */
export function NotificationBell(): ReactElement {
  const t = useTranslation('core');
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

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        className="b2b-topbar__icon-btn"
        title={t('appShell.topbar.notifications')}
        aria-label={t('appShell.topbar.notifications')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(): void => {
          if (!open) void refresh();
          setOpen((v) => !v);
        }}
      >
        <Bell size={16} />
        {badge ? <span style={BADGE_STYLE}>{badge}</span> : null}
      </button>
      {open ? (
        <div ref={dropdownRef} style={DROPDOWN_STYLE} role="menu">
          <div style={DROPDOWN_HEADER_STYLE}>
            <strong>{t('appShell.notifications.title')}</strong>
            {unreadCount > 0 ? (
              <button
                type="button"
                style={MARK_ALL_BTN}
                onClick={(): void => void markAllRead()}
                title={t('appShell.notifications.markAllRead')}
              >
                <CheckCheck size={14} />
                {t('appShell.notifications.markAllRead')}
              </button>
            ) : null}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {items.length === 0 ? (
              <div style={EMPTY_STYLE}>{t('appShell.notifications.empty')}</div>
            ) : (
              items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  role="menuitem"
                  style={{ ...ROW_STYLE, ...(it.isRead ? ROW_READ_STYLE : ROW_UNREAD_STYLE) }}
                  onClick={(): void => handleClick(it)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: it.isRead ? 400 : 600, flex: 1 }}>{it.title}</span>
                    <time
                      style={{ fontSize: 11, color: 'var(--text-muted, #888)' }}
                      dateTime={it.createdAt}
                    >
                      {formatRelative(it.createdAt)}
                    </time>
                  </div>
                  {it.body ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 2 }}>
                      {it.body}
                    </div>
                  ) : null}
                </button>
              ))
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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((now - then) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d`;
}

const BADGE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 2,
  background: '#dc2626',
  color: '#fff',
  borderRadius: 999,
  fontSize: 10,
  lineHeight: 1,
  padding: '2px 5px',
  fontWeight: 600,
  minWidth: 16,
  textAlign: 'center',
};

const DROPDOWN_STYLE: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 6px)',
  width: 340,
  maxWidth: 'calc(100vw - 24px)',
  background: 'var(--bg-surface, #fff)',
  border: '1px solid var(--border-color, #e5e7eb)',
  borderRadius: 8,
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.15)',
  zIndex: 100,
  overflow: 'hidden',
};

const DROPDOWN_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 14px',
  borderBottom: '1px solid var(--border-color, #e5e7eb)',
  background: 'var(--bg-muted, #fafafa)',
};

const MARK_ALL_BTN: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  color: 'var(--text-muted, #555)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
};

const ROW_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: '1px solid var(--border-color, #e5e7eb)',
  background: 'none',
  cursor: 'pointer',
};

const ROW_UNREAD_STYLE: CSSProperties = {
  borderLeft: '3px solid #2563eb',
  paddingLeft: 11,
};

const ROW_READ_STYLE: CSSProperties = {
  borderLeft: '3px solid transparent',
  paddingLeft: 11,
};

const EMPTY_STYLE: CSSProperties = {
  padding: '24px 14px',
  textAlign: 'center',
  color: 'var(--text-muted, #888)',
  fontSize: 13,
};
