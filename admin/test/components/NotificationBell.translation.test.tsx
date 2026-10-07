import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TranslationProvider } from '../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';
import type { AdminNotificationItem } from '../../../packages/admin-shell/src/components/notifications/useAdminNotifications';

/**
 * The bell draws an entry in the reader's language when the entry says how
 * (`specs/143-crm-sales-opportunities/spec.md` FR-085, research N-T1).
 *
 * An entry is one row read by several administrators, so its writer cannot
 * translate it: it carries `titleMessage` / `bodyMessage` — a bundle scope, a
 * key and params — beside the finished English `title` / `body`. The bell
 * resolves the message through the bundles it already holds and shows the
 * finished sentence whenever it cannot. **It never shows a raw key**: the
 * module that wrote an entry may be switched off, or gone, by the time the
 * entry is read.
 */

let items: AdminNotificationItem[] = [];

vi.mock('../../../packages/admin-shell/src/components/notifications/useAdminNotifications', () => ({
  useAdminNotifications: () => ({
    items,
    unreadCount: items.length,
    loading: false,
    error: null,
    refresh: async () => {},
    markRead: async () => {},
    markAllRead: async () => {},
  }),
}));

const { NotificationBell } =
  await import('../../../packages/admin-shell/src/components/notifications/NotificationBell');

const EN: Bundle = {
  core: { 'appShell.topbar.notifications': 'Notifications' },
  crm: {
    'notifications.mention.title': '{author} mentioned you in opportunity {number}',
    'notifications.mention.body': 'Open opportunity {number} to read on',
    'notifications.onlyEnglish.title': 'Only in English: {number}',
  },
};

const PL: Bundle = {
  core: { 'appShell.topbar.notifications': 'Powiadomienia' },
  crm: {
    'notifications.mention.title': '{author} wspomina o Tobie w szansie {number}',
    'notifications.mention.body': 'Otwórz szansę {number}, aby czytać dalej',
  },
};

function entry(overrides: Partial<AdminNotificationItem> = {}): AdminNotificationItem {
  return {
    id: 'n-1',
    audience: 'admin_user',
    kind: 'crm.opportunity.mention',
    subjectType: 'crm_opportunity',
    subjectId: 'o-1',
    title: 'Ada mentioned you in opportunity OPP-000042',
    body: null,
    linkPath: '/crm/opportunities/o-1',
    createdAt: new Date().toISOString(),
    isRead: false,
    ...overrides,
  };
}

/** Render the bell for a reader of `language`, open it, and answer the one row's text. */
function openBell(language: 'en' | 'pl', feed: AdminNotificationItem[]): HTMLElement {
  items = feed;
  render(
    <TranslationProvider
      language={language}
      initialBundle={language === 'pl' ? PL : EN}
      initialFallbackBundle={EN}
    >
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </TranslationProvider>,
  );
  fireEvent.click(
    screen.getByRole('button', { name: language === 'pl' ? 'Powiadomienia' : 'Notifications' }),
  );
  return screen.getByRole('menuitem');
}

const MENTION = {
  scope: 'crm',
  key: 'notifications.mention.title',
  params: { author: 'Ada', number: 'OPP-000042' },
};

describe("NotificationBell — an entry in the reader's language", () => {
  beforeEach(() => {
    items = [];
  });

  it('draws the title from the Polish bundle for a Polish reader', () => {
    const row = openBell('pl', [entry({ titleMessage: MENTION })]);
    expect(row.textContent).toContain('Ada wspomina o Tobie w szansie OPP-000042');
    expect(row.textContent).not.toContain('mentioned you');
  });

  it('draws the title from the English bundle for an English reader — not the stored sentence', () => {
    const row = openBell('en', [entry({ title: 'A STORED SENTENCE', titleMessage: MENTION })]);
    expect(row.textContent).toContain('Ada mentioned you in opportunity OPP-000042');
    expect(row.textContent).not.toContain('A STORED SENTENCE');
  });

  it('draws the body the same way', () => {
    const row = openBell('pl', [
      entry({
        body: 'Open opportunity OPP-000042 to read on',
        titleMessage: MENTION,
        bodyMessage: {
          scope: 'crm',
          key: 'notifications.mention.body',
          params: { number: 'OPP-000042' },
        },
      }),
    ]);
    expect(row.textContent).toContain('Otwórz szansę OPP-000042, aby czytać dalej');
    expect(row.textContent).not.toContain('to read on');
  });

  it('falls back to the English template when the Polish bundle has no such key', () => {
    const row = openBell('pl', [
      entry({
        title: 'A STORED SENTENCE',
        titleMessage: {
          scope: 'crm',
          key: 'notifications.onlyEnglish.title',
          params: { number: 'OPP-000042' },
        },
      }),
    ]);
    expect(row.textContent).toContain('Only in English: OPP-000042');
  });

  describe('shows the finished sentence, never a raw key', () => {
    const cases: Array<[string, Partial<AdminNotificationItem>]> = [
      ['an entry with no such member — an older entry, or a backend that predates the field', {}],
      ['an explicit null', { titleMessage: null }],
      [
        'a key no bundle holds',
        { titleMessage: { scope: 'crm', key: 'notifications.retired.title', params: {} } },
      ],
      [
        'a module whose bundle is not loaded — switched off, or not installed',
        { titleMessage: { scope: 'pim_ergonode', key: 'notifications.run.title', params: {} } },
      ],
      [
        'a template naming a param the entry does not carry',
        {
          titleMessage: {
            scope: 'crm',
            key: 'notifications.mention.title',
            params: { author: 'Ada' },
          },
        },
      ],
      [
        'a message that is not the shape the contract describes',
        { titleMessage: { scope: 'crm' } as never },
      ],
      [
        'a param that is not text',
        {
          titleMessage: {
            scope: 'crm',
            key: 'notifications.mention.title',
            params: { author: { toString: () => 'x' }, number: 'OPP-000042' },
          } as never,
        },
      ],
    ];

    it.each(cases)('%s', (_name, overrides) => {
      const row = openBell('pl', [entry(overrides)]);
      expect(row.textContent).toContain('Ada mentioned you in opportunity OPP-000042');
      expect(row.textContent).not.toMatch(/notifications\.[a-z]/i);
      expect(row.textContent).not.toContain('{');
    });
  });

  it('keeps a body with no resolvable message, and draws none where there is none', () => {
    const row = openBell('pl', [
      entry({
        body: 'A finished body',
        bodyMessage: { scope: 'crm', key: 'notifications.retired.body', params: {} },
      }),
    ]);
    expect(row.textContent).toContain('A finished body');
    expect(row.textContent).not.toContain('notifications.retired.body');
  });

  it('draws a param as text — markup in it is never markup', () => {
    const row = openBell('pl', [
      entry({
        titleMessage: {
          scope: 'crm',
          key: 'notifications.mention.title',
          params: { author: '<img src=x onerror=alert(1)>', number: 'OPP-000042' },
        },
      }),
    ]);
    expect(row.querySelector('img')).toBeNull();
    expect(row.textContent).toContain(
      '<img src=x onerror=alert(1)> wspomina o Tobie w szansie OPP-000042',
    );
  });
});
