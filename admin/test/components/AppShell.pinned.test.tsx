import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../setup';
import { adminSession, everyDeclaredModule, modulePresence } from '../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated.js';
import { TranslationProvider, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  pinnedSection,
  realBundle,
  renderShell,
  sidebar,
} from '../helpers/app-shell-preferences';

/**
 * Feature 164, US1 — pin the sidebar entries I use most
 * (`specs/164-admin-user-preferences/spec.md` US1 AS-1 – AS-12; FR-001 – FR-005,
 * FR-007, FR-008, FR-016, FR-017, FR-024).
 */

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));
vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));
vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

const PREFS_URL = '/api/v1/admin/me/preferences';
let patchSpy: ReturnType<typeof vi.spyOn>;

const patchBodies = (): unknown[] =>
  (patchSpy.mock.calls as unknown[][]).filter(([path]) => path === PREFS_URL).map(([, body]) => body);

function sidebarLink(name: string): HTMLElement {
  return within(sidebar()).getAllByRole('link', { name }).find((el) => !el.closest('[data-testid="sidebar-pinned"]'))!;
}

function pinStatus(): string {
  return screen.getByTestId('sidebar-pin-status').textContent ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  patchSpy = vi.spyOn(apiClient, 'patch').mockImplementation(async (_path: string, body: unknown) => ({
    data: { sidebarPins: [], sidebarCollapsedGroups: [], sidebarRailMode: false, listPageSizes: {}, ...(body as object) },
  }));
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setMobileViewport(false);
});

describe('Pinned section — US1', () => {
  it('AS-1: with no pins there is no Pinned heading and every entry is where it is', () => {
    renderShell(AppShell);
    expect(pinnedSection()).toBeNull();
    expect(within(sidebar()).queryByText('Pinned')).toBeNull();
    expect(sidebarLink('Orders')).toBeTruthy();
  });

  it('AS-2 / FR-004: each entry has a separate pin button after its link, not inside it', () => {
    renderShell(AppShell);
    const link = sidebarLink('Orders');
    const button = within(sidebar()).getByRole('button', { name: 'Pin Orders' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(link.contains(button)).toBe(false);
    expect(button.closest('a')).toBeNull();
    expect(link.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('owner ruling: Tab goes link → its pin button → next link, and pinning never moves focus', async () => {
    const user = userEvent.setup();
    renderShell(AppShell);
    const link = sidebarLink('Orders');
    link.focus();
    await user.tab();
    const button = within(sidebar()).getByRole('button', { name: 'Pin Orders' });
    expect(document.activeElement).toBe(button);
    await user.tab();
    expect(document.activeElement?.tagName).toBe('A');
    expect(document.activeElement).not.toBe(link);
    button.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(within(sidebar()).getAllByRole('button', { name: 'Unpin Orders' }).at(-1));
  });

  it('AS-3: pinning shows a Pinned section first, keeps the entry in its section, announces and saves', async () => {
    renderShell(AppShell);
    await act(async () => fireEvent.click(within(sidebar()).getByRole('button', { name: 'Pin Orders' })));
    const section = pinnedSection();
    expect(section).not.toBeNull();
    const firstGroup = sidebar().querySelector('.b2b-sidebar__nav .b2b-sidebar__group');
    expect(firstGroup).toBe(section);
    expect(within(section!).getByText('Pinned')).toBeTruthy();
    expect(within(section!).getByRole('link', { name: 'Orders' })).toBeTruthy();
    expect(sidebarLink('Orders')).toBeTruthy();
    expect(pinStatus()).toBe('Orders pinned');
    await waitFor(() => expect(patchBodies()).toEqual([{ sidebarPins: ['/orders'] }]));
  });

  it('AS-4 / FR-007: a further pin is appended at the end', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders'] } });
    await act(async () => fireEvent.click(within(sidebar()).getByRole('button', { name: 'Pin Customers' })));
    const names = within(pinnedSection()!).getAllByRole('link').map((el) => el.textContent);
    expect(names).toEqual(['Orders', 'Customers']);
    await waitFor(() => expect(patchBodies()).toEqual([{ sidebarPins: ['/orders', '/customers'] }]));
  });

  it('AS-5: unpin works from the Pinned section and from the original row; the last unpin removes the section', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders', '/customers'] } });
    await act(async () =>
      fireEvent.click(within(pinnedSection()!).getByRole('button', { name: 'Unpin Orders' })),
    );
    expect(pinStatus()).toBe('Orders unpinned');
    expect(within(pinnedSection()!).queryByRole('link', { name: 'Orders' })).toBeNull();
    const original = within(sidebar())
      .getAllByRole('button', { name: 'Unpin Customers' })
      .find((el) => !el.closest('[data-testid="sidebar-pinned"]'))!;
    await act(async () => fireEvent.click(original));
    expect(pinStatus()).toBe('Customers unpinned');
    expect(pinnedSection()).toBeNull();
    await waitFor(() => expect(patchBodies().at(-1)).toEqual({ sidebarPins: [] }));
  });

  it('AS-6 / FR-016: seeded pins are in the very first render', () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders'] } });
    // Synchronously, before any `waitFor`.
    expect(pinnedSection()).not.toBeNull();
    expect(within(pinnedSection()!).getByRole('link', { name: 'Orders' })).toBeTruthy();
  });

  it("AS-7: a different admin's session shows none of the first admin's pins", () => {
    const first = renderShell(AppShell, {
      session: adminSession({ permissions: ['*'], id: '00000000-0000-4000-8000-0000000164c1' }),
      preferences: { sidebarPins: ['/orders'] },
    });
    expect(pinnedSection()).not.toBeNull();
    first.unmount();
    renderShell(AppShell, {
      session: adminSession({ permissions: ['*'], id: '00000000-0000-4000-8000-0000000164c2' }),
      preferences: { sidebarPins: [] },
    });
    expect(pinnedSection()).toBeNull();
  });

  it('AS-8: on a pinned destination both the pinned row and the original are active', () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders'] }, path: '/orders' });
    expect(within(pinnedSection()!).getByRole('link', { name: 'Orders' }).className).toContain('is-active');
    expect(sidebarLink('Orders').className).toContain('is-active');
  });

  it('AS-9: in rail mode the first rail entry is the Pinned section, listing pins with unpin buttons', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders', '/customers'] } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar (⌘B)' })));
    const rows = sidebar().querySelectorAll('.b2b-sidebar__nav .b2b-sidebar__rail-row');
    const first = rows[0] as HTMLElement;
    const trigger = within(first).getByRole('button', { name: 'Pinned' });
    await act(async () => fireEvent.click(trigger));
    const popover = first.querySelector('.b2b-sidebar__rail-popover') as HTMLElement;
    expect(within(popover).getAllByRole('link').map((el) => el.textContent)).toEqual(['Orders', 'Customers']);
    expect(within(popover).getByRole('button', { name: 'Unpin Orders' })).toBeTruthy();
    await act(async () => fireEvent.click(within(popover).getByRole('button', { name: 'Unpin Orders' })));
    await waitFor(() => expect(patchBodies().at(-1)).toEqual({ sidebarPins: ['/customers'] }));
  });

  it('AS-10: in the mobile drawer the pin control is shown without hover and is a ≥ 44 px touch target', async () => {
    setMobileViewport(true);
    renderShell(AppShell);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open menu' })));
    const button = within(sidebar()).getByRole('button', { name: 'Pin Orders' });
    expect(button.className).toContain('b2b-nav-pin--touch');
  });

  it('AS-11 / FR-008: twelve pins all render, a thirteenth is accepted, and no count is shown', async () => {
    renderShell(AppShell);
    const destinations = [
      ...new Set(
        within(sidebar())
          .getAllByRole('link')
          .map((el) => el.getAttribute('href') ?? '')
          .filter((href) => href !== '/' && href !== '/profile' && href.startsWith('/')),
      ),
    ].slice(0, 13);
    expect(destinations).toHaveLength(13);
    cleanup();
    renderShell(AppShell, { preferences: { sidebarPins: destinations.slice(0, 12) } });
    expect(within(pinnedSection()!).getAllByRole('link')).toHaveLength(12);
    const thirteenth = within(sidebar())
      .getAllByRole('button', { name: /^Pin / })
      .find((el) => !el.closest('[data-testid="sidebar-pinned"]'))!;
    await act(async () => fireEvent.click(thirteenth));
    expect(within(pinnedSection()!).getAllByRole('link')).toHaveLength(13);
    expect(pinnedSection()!.textContent).not.toMatch(/\b1[23]\b/);
  });

  it('AS-12: in Polish the heading and the accessible names are Polish', () => {
    renderShell(AppShell, { language: 'pl', preferences: { sidebarPins: ['/orders'] } });
    expect(within(pinnedSection()!).getByText('Przypięte')).toBeTruthy();
    expect(within(pinnedSection()!).getByRole('button', { name: 'Odepnij: Zamówienia' })).toBeTruthy();
    expect(within(sidebar()).getByRole('button', { name: 'Przypnij: Klienci' })).toBeTruthy();
  });

  it('edge case: two pinned entries sharing a label are told apart by their source sections', () => {
    renderShell(AppShell, {
      preferences: { sidebarPins: ['/orders', '/twin-orders'] },
      presence: modulePresence({ present: [...everyDeclaredModule(), 'twin_module'] }),
      extraBundle: { twin_module: { 'nav.twin.label': 'Orders' } },
      registry: [
        ...MODULE_ADMIN_CONTRIBUTIONS,
        {
          moduleId: 'twin_module',
          contributions: {
            nav: [{ to: '/twin-orders', labelKey: 'nav.twin.label', icon: 'Package', section: 'catalog', weight: 999 }],
          },
        },
      ],
    });
    const rows = within(pinnedSection()!).getAllByRole('link', { name: 'Orders' });
    expect(rows).toHaveLength(2);
    const describe = (el: HTMLElement): string =>
      (el.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
    const en = realBundle('en').core!;
    expect(describe(rows[0]!)).toBe(en['appShell.pinned.fromSection']!.replace('{section}', en['appShell.section.sales']!));
    expect(describe(rows[1]!)).toBe(en['appShell.pinned.fromSection']!.replace('{section}', en['appShell.section.catalog']!));
  });
});

describe('a failed save — FR-017', () => {
  it('keeps the pin on screen and shows one dismissible, non-modal notice per episode', async () => {
    patchSpy.mockRejectedValue(new Error('offline'));
    renderShell(AppShell);
    await act(async () => fireEvent.click(within(sidebar()).getByRole('button', { name: 'Pin Orders' })));
    expect(pinnedSection()).not.toBeNull();
    const en = realBundle('en').core!;
    const notice = await screen.findByText(en['adminPreferences.saveFailed']!);
    expect(notice.closest('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('button', { name: en['adminPreferences.dismiss']! })).toBeTruthy();
    await act(async () => fireEvent.click(within(sidebar()).getByRole('button', { name: 'Pin Customers' })));
    await waitFor(() => expect(patchBodies().length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByText(en['adminPreferences.saveFailed']!)).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: en['adminPreferences.dismiss']! })));
    expect(screen.queryByText(en['adminPreferences.saveFailed']!)).toBeNull();
  });
});

describe('the palette — FR-024', () => {
  async function paletteGroups(): Promise<Array<[string, number]>> {
    await act(async () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
    const dialog = await screen.findByRole('dialog');
    const groups: Array<[string, number]> = [];
    for (const header of dialog.querySelectorAll('.b2b-palette__group')) {
      groups.push([header.textContent ?? '', 0]);
    }
    const counts = new Map<string, number>();
    let current = '';
    for (const el of dialog.querySelectorAll('.b2b-palette__group, .b2b-palette__item')) {
      if (el.classList.contains('b2b-palette__group')) current = el.textContent ?? '';
      else counts.set(current, (counts.get(current) ?? 0) + 1);
    }
    return groups.map(([name]) => [name, counts.get(name) ?? 0]);
  }

  it('pinning adds no palette entry and no palette group', async () => {
    renderShell(AppShell);
    const without = await paletteGroups();
    cleanup();
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders', '/customers'] } });
    const withPins = await paletteGroups();
    expect(withPins).toEqual(without);
    expect(without.length).toBeGreaterThan(0);
  });
});

describe('every new string resolves in English and Polish (FR-025, SC-009)', () => {
  // Client contract §5 — the twenty `core` keys this feature ships.
  const KEYS = [
    'appShell.pinned.heading',
    'appShell.pinned.pin',
    'appShell.pinned.unpin',
    'appShell.pinned.fromSection',
    'appShell.pinned.fromMain',
    'appShell.pinned.announce.pinned',
    'appShell.pinned.announce.unpinned',
    'appShell.pinned.reorder.handle',
    'appShell.pinned.reorder.grabbed',
    'appShell.pinned.reorder.moving',
    'appShell.pinned.reorder.dropped',
    'appShell.pinned.reorder.cancelled',
    'appShell.pinned.reorder.moved',
    'appShell.pinned.reorder.atStart',
    'appShell.pinned.reorder.atEnd',
    'appShell.palette.pin.hintPin',
    'appShell.palette.pin.hintUnpin',
    'appShell.palette.pin.instructions',
    'adminPreferences.saveFailed',
    'adminPreferences.dismiss',
  ];
  const PARAMS = { label: 'X1', section: 'X2', index: 3, total: 4 };

  function Strings(): React.ReactElement {
    const t = useTranslation('core');
    return (
      <ul>
        {KEYS.map((key) => (
          <li key={key} data-key={key}>
            {t(key, PARAMS)}
          </li>
        ))}
      </ul>
    );
  }

  it.each(['en', 'pl'] as const)('%s', (language) => {
    expect(KEYS).toHaveLength(20);
    render(
      <TranslationProvider language={language} initialBundle={realBundle(language)} initialFallbackBundle={realBundle('en')}>
        <Strings />
      </TranslationProvider>,
    );
    for (const key of KEYS) {
      const text = document.querySelector(`[data-key="${key}"]`)?.textContent ?? '';
      expect(text, key).not.toBe('');
      expect(text, key).not.toContain(key);
      expect(text, key).not.toMatch(/\{[a-z]+\}/);
      expect(realBundle(language).core![key], `${key} in ${language}`).toBeDefined();
    }
  });
});
