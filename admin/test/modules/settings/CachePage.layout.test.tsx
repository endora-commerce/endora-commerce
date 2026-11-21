import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1550 (UX audit SHELL-10) — the cache screen is one card with three
 * rows (Common Region, Hick): each row is an action label, a one-line effect
 * and its button, and the result of an action is said beside that button
 * (`InlineStatus`), not in a banner at the top of the page.
 */

const listSpy = vi.fn();
const clearSpy = vi.fn();
const reindexSpy = vi.fn();

vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: {
    listCacheNamespaces: () => listSpy(),
    clearCache: (...args: unknown[]) => clearSpy(...args),
    reindexSearch: () => reindexSpy(),
  },
}));

const { CachePage } = await import('../../../../packages/modules/settings/src/admin/pages/CachePage');

const BUNDLE = passthroughBundle('settings', [
  'cache.page.title',
  'cache.loading',
  'cache.selectAll',
  'cache.clearSelected',
  'cache.clearAll',
  'cache.refresh',
  'cache.cleared',
  'cache.disabled',
  'cache.error.load',
  'cache.error.clear',
  'cache.clear.title',
  'cache.clear.description',
  'cache.namespaces.label',
  'cache.i18n.title',
  'cache.i18n.description',
  'cache.i18n.button',
  'search.reindex.title',
  'search.reindex.description',
  'search.reindex.button',
  'search.reindex.done',
  'search.reindex.error',
  'tabs.settings',
  'tabs.groups',
  'tabs.cache',
  // Resolved to themselves, so the page falls back to the backend's label.
  'cache.namespace.settings.label',
  'cache.namespace.settings.description',
  'cache.namespace.cms.label',
  'cache.namespace.cms.description',
]);

beforeEach(() => {
  listSpy.mockReset();
  clearSpy.mockReset();
  reindexSpy.mockReset();
  listSpy.mockResolvedValue({
    cacheEnabled: true,
    data: [
      { key: 'settings', label: 'Settings', description: 'Resolved settings.' },
      { key: 'cms', label: 'CMS', description: 'CMS pages.' },
    ],
  });
});

async function renderPage(): Promise<void> {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/settings/cache']}>
        <CachePage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['settings:read', 'settings:write'] }),
        presence: modulePresence({ present: ['settings'] }),
      },
    ),
    BUNDLE,
  );
  await screen.findByRole('checkbox', { name: 'cache.selectAll' });
}

describe('CachePage — one card, three rows (#1550)', () => {
  it('puts the three actions in one card, each a heading, a one-line effect and its button', async () => {
    await renderPage();
    const cards = document.querySelectorAll('[data-slot="card"]');
    expect(cards).toHaveLength(1);
    const rows = within(cards[0] as HTMLElement).getAllByRole('region');
    expect(rows.map((row) => within(row).getAllByRole('heading')[0]?.textContent)).toEqual([
      'cache.clear.title',
      'search.reindex.title',
      'cache.i18n.title',
    ]);
    const [clearRow, reindexRow, i18nRow] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(clearRow).toHaveAccessibleDescription('cache.clear.description');
    expect(reindexRow).toHaveAccessibleDescription('search.reindex.description');
    expect(i18nRow).toHaveAccessibleDescription('cache.i18n.description');
    expect(within(clearRow).getByRole('button', { name: 'cache.clearAll' })).toBeInTheDocument();
    expect(within(reindexRow).getByRole('button', { name: 'search.reindex.button' })).toBeInTheDocument();
    expect(within(i18nRow).getByRole('button', { name: 'cache.i18n.button' })).toBeInTheDocument();
  });

  it('offers no filled button: the maintenance actions are equals, none is the page primary', async () => {
    await renderPage();
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).not.toMatch(/\bbg-primary\b/);
    }
  });

  it('says the result of an action beside its own button, in an always-mounted status', async () => {
    reindexSpy.mockResolvedValue({ channelsReindexed: 2, documentCount: 40 });
    await renderPage();
    const reindexRow = screen.getByRole('region', { name: 'search.reindex.title' });
    const status = within(reindexRow).getByRole('status');
    expect(status).toBeEmptyDOMElement();
    await userEvent.click(within(reindexRow).getByRole('button', { name: 'search.reindex.button' }));
    await waitFor(() => expect(status).toHaveTextContent('search.reindex.done'));
    expect(document.querySelector('[data-slot="alert"]')).toBeNull();
  });

  it('reports a failed clear beside the clear row, and keeps the selection for a retry', async () => {
    clearSpy.mockRejectedValue(new Error('boom'));
    await renderPage();
    const clearRow = screen.getByRole('region', { name: 'cache.clear.title' });
    await userEvent.click(within(clearRow).getByRole('checkbox', { name: 'CMS' }));
    await userEvent.click(within(clearRow).getByRole('button', { name: 'cache.clearSelected' }));
    await waitFor(() => expect(within(clearRow).getByRole('status')).toHaveTextContent('cache.error.clear'));
    expect(clearSpy).toHaveBeenCalledWith({ namespaces: ['cms'] });
    expect(within(clearRow).getByRole('checkbox', { name: 'CMS' })).toBeChecked();
  });

  it('shows the section tabs under the page title', async () => {
    await renderPage();
    expect(screen.getByRole('tab', { name: 'tabs.cache' })).toHaveAttribute('aria-selected', 'true');
  });
});
