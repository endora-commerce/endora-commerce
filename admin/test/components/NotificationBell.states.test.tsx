import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
const { markReadSpy, markAllReadSpy, refreshSpy } = vi.hoisted(() => ({
  markReadSpy: vi.fn(async (_id: string) => {}),
  markAllReadSpy: vi.fn(async () => {}),
  refreshSpy: vi.fn(async () => {}),
}));

vi.mock('../../../packages/admin-shell/src/components/notifications/useAdminNotifications', () => ({
  useAdminNotifications: () => ({
    items,
    unreadCount: items.filter((it) => !it.isRead).length,
    loading: false,
    error: null,
    refresh: refreshSpy,
    markRead: markReadSpy,
    markAllRead: markAllReadSpy,
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
  markReadSpy.mockClear();
  markAllReadSpy.mockClear();
  refreshSpy.mockClear();
  render(
    <TranslationProvider language="en" initialBundle={EN} initialFallbackBundle={EN}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<NotificationBell />} />
          <Route path="/tasks/:id" element={<p>Task page</p>} />
        </Routes>
      </MemoryRouter>
    </TranslationProvider>,
  );
}

function bellButton(): HTMLElement {
  // `hidden`: an open modal menu hides the rest of the page from the tree.
  return screen.getByRole('button', { name: /Notifications/, hidden: true });
}

/** Radix opens a menu on `pointerdown`, not on `click` (#1783). */
function openWithPointer(): HTMLElement {
  fireEvent.pointerDown(bellButton(), { button: 0, ctrlKey: false });
  return screen.getByRole('menu');
}

/** The feed's rows — every menu entry but the footer's "Mark all read". */
function rows(): HTMLElement[] {
  return within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .filter((el) => el.textContent !== EN.core!['appShell.notifications.markAllRead']);
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
    openWithPointer();
    const [unread, read] = rows();
    expect(unread!.textContent).toContain('Unread');
    expect(read!.textContent).not.toContain('Unread');
  });

  it('draws the empty feed as one muted line', () => {
    renderBell([]);
    const menu = openWithPointer();
    expect(within(menu).getByText('No notifications.')).toBeTruthy();
    expect(within(menu).queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('draws no inline style and no hard-coded colour', () => {
    renderBell([entry({ id: 'a' }), entry({ id: 'b', isRead: true })]);
    const menu = openWithPointer();
    // The panel is portalled and placed by Radix, whose inline positioning is
    // not ours to draw; the trigger and everything inside the panel are Tailwind.
    expect(bellButton().parentElement!.querySelectorAll('[style]')).toHaveLength(0);
    expect(menu.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('NotificationBell — the kit DropdownMenu keyboard contract (#1783)', () => {
  const focused = (): Element | null => document.activeElement;

  it('is the kit menu: portalled out of the top bar, named by its title', () => {
    renderBell([entry()]);
    const menu = openWithPointer();
    expect(menu).toHaveAccessibleName('Notifications');
    expect(bellButton().parentElement!.contains(menu)).toBe(false);
    expect(bellButton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('refreshes the feed on opening', () => {
    renderBell([entry()]);
    openWithPointer();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('opens from the keyboard with focus inside, and walks the entries with arrows, Home and End', async () => {
    renderBell([
      entry({ id: 'a', title: 'First' }),
      entry({ id: 'b', title: 'Second' }),
      entry({ id: 'c', title: 'Third', isRead: true }),
    ]);
    bellButton().focus();
    await userEvent.keyboard('{Enter}');
    const menu = screen.getByRole('menu');
    expect(menu.contains(focused())).toBe(true);

    const entries = within(menu).getAllByRole('menuitem');
    await userEvent.keyboard('{Home}');
    expect(focused()).toBe(entries[0]);
    await userEvent.keyboard('{ArrowDown}');
    expect(focused()).toBe(entries[1]);
    await userEvent.keyboard('{End}');
    expect(focused()).toBe(entries.at(-1));
    await userEvent.keyboard('{ArrowUp}');
    expect(focused()).toBe(entries.at(-2));
  });

  it('jumps to a row by typing the start of its title', async () => {
    renderBell([entry({ id: 'a', title: 'Alpha' }), entry({ id: 'b', title: 'Quote expired' })]);
    bellButton().focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('q');
    expect(focused()).toHaveTextContent('Quote expired');
  });

  it('closes on Escape and gives focus back to the bell', async () => {
    renderBell([entry()]);
    bellButton().focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(focused()).toBe(bellButton());
  });

  it('opens a row chosen with Enter: marks it read, follows its link and closes', async () => {
    renderBell([entry({ id: 'n-7', title: 'Task assigned', linkPath: '/tasks/t-1' })]);
    bellButton().focus();
    await userEvent.keyboard('{Enter}');
    const [row] = rows();
    row!.focus();
    await userEvent.keyboard('{Enter}');
    expect(markReadSpy).toHaveBeenCalledExactlyOnceWith('n-7');
    await waitFor(() => expect(screen.getByText('Task page')).toBeInTheDocument());
  });

  it('lands keyboard focus on the newest notification, so Enter twice cannot mark everything read', async () => {
    renderBell([entry({ id: 'a', title: 'Newest' }), entry({ id: 'b', title: 'Older' })]);
    bellButton().focus();
    await userEvent.keyboard('{Enter}');
    expect(focused()).toBe(rows()[0]);
    expect(focused()).toHaveTextContent('Newest');
    await userEvent.keyboard('{Enter}');
    expect(markAllReadSpy).not.toHaveBeenCalled();
    expect(markReadSpy).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('puts "Mark all read" last, after a separator, where End reaches it', async () => {
    renderBell([entry({ id: 'a' }), entry({ id: 'b' })]);
    bellButton().focus();
    await userEvent.keyboard('{Enter}');
    const menu = screen.getByRole('menu');
    const entries = within(menu).getAllByRole('menuitem');
    const markAll = within(menu).getByRole('menuitem', { name: 'Mark all read' });
    expect(entries.at(-1)).toBe(markAll);
    expect(markAll.previousElementSibling).toHaveAttribute('role', 'separator');
    await userEvent.keyboard('{End}');
    expect(focused()).toBe(markAll);
    await userEvent.keyboard('{Enter}');
    expect(markAllReadSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('offers no "Mark all read" when nothing is unread', () => {
    renderBell([entry({ isRead: true })]);
    const menu = openWithPointer();
    expect(within(menu).queryByRole('menuitem', { name: 'Mark all read' })).toBeNull();
    expect(within(menu).queryByRole('separator')).toBeNull();
  });

  it('keeps the menu open after "Mark all read", so the result is visible where it was asked for', async () => {
    renderBell([entry({ id: 'a' }), entry({ id: 'b' })]);
    const menu = openWithPointer();
    const markAll = within(menu).getByRole('menuitem', { name: 'Mark all read' });
    markAll.focus();
    await userEvent.keyboard('{Enter}');
    expect(markAllReadSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
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
