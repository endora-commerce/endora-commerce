import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import type { AdminNotificationItem } from '../../../packages/admin-shell/src/components/notifications/useAdminNotifications';

/**
 * The top-bar bell on the kit and Tailwind tokens (#1492, UX audit slice S16).
 *
 * Its unread count was a red pill drawn inside a button whose `aria-label`
 * replaces the content, so the count never reached assistive technology; an
 * unread row was marked by a blue bar and a bold title only (WCAG 1.4.1); and
 * the relative time was English in every language ("just now", "5m").
 */

let items: AdminNotificationItem[] = [];

vi.mock('../../../packages/admin-shell/src/components/notifications/useAdminNotifications', () => ({
  useAdminNotifications: () => ({
    items,
    unreadCount: items.filter((it) => !it.isRead).length,
    loading: false,
    error: null,
    refresh: async () => {},
    markRead: async () => {},
    markAllRead: async () => {},
  }),
}));

const { NotificationBell, formatRelative } =
  await import('../../../packages/admin-shell/src/components/notifications/NotificationBell');

const EN: Bundle = {
  core: {
    'appShell.topbar.notifications': 'Notifications',
    'appShell.topbar.notificationsUnread': 'Notifications, {count} unread',
    'appShell.notifications.unread': 'Unread',
    'appShell.notifications.title': 'Notifications',
    'appShell.notifications.markAllRead': 'Mark all read',
    'appShell.notifications.empty': 'No notifications.',
  },
};

function entry(overrides: Partial<AdminNotificationItem> = {}): AdminNotificationItem {
  return {
    id: 'n-1',
    audience: 'admin_user',
    kind: 'tasks.assigned',
    subjectType: 'task',
    subjectId: 't-1',
    title: 'A task was assigned to you',
    body: null,
    linkPath: null,
    createdAt: new Date().toISOString(),
    isRead: false,
    ...overrides,
  };
}

function renderBell(feed: AdminNotificationItem[]): void {
  items = feed;
  render(
    <TranslationProvider language="en" initialBundle={EN} initialFallbackBundle={EN}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </TranslationProvider>,
  );
}

describe('NotificationBell — states', () => {
  it('names the unread count in the button, not only in the red pill', () => {
    renderBell([entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c', isRead: true })]);
    expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeTruthy();
  });

  it('keeps the plain name when nothing is unread', () => {
    renderBell([entry({ isRead: true })]);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
  });

  it('says an unread row is unread in text, beside the bar and the weight', () => {
    renderBell([entry({ id: 'a' }), entry({ id: 'b', isRead: true, title: 'Read one' })]);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    const [unread, read] = screen.getAllByRole('menuitem');
    expect(unread!.textContent).toContain('Unread');
    expect(read!.textContent).not.toContain('Unread');
  });

  it('draws the empty feed as one muted line', () => {
    renderBell([]);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('No notifications.')).toBeTruthy();
  });

  it('draws no inline style and no hard-coded colour', () => {
    renderBell([entry({ id: 'a' }), entry({ id: 'b', isRead: true })]);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(document.body.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('formatRelative — in the reader’s language', () => {
  const now = Date.parse('2026-11-22T12:00:00Z');
  const ago = (ms: number): string => new Date(now - ms).toISOString();

  it.each([
    ['en', 10_000, 'now'],
    ['pl', 10_000, 'teraz'],
    ['en', 5 * 60_000, '5m ago'],
    ['pl', 5 * 60_000, '5 min temu'],
    ['en', 3 * 3_600_000, '3h ago'],
    ['pl', 2 * 86_400_000, '2 dni temu'],
  ] as const)('%s, %i ms ago → %s', (language, ms, expected) => {
    expect(formatRelative(ago(ms), language, now)).toBe(expected);
  });
});
