import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { expectNoAxeViolations } from '../helpers/axe';
import { realBundle, renderShell } from '../helpers/app-shell-preferences';

/**
 * Issue #481 — the ⌘K palette follows the ARIA combobox-with-listbox pattern,
 * so a screen reader hears which row is highlighted: the search input is a
 * `combobox` controlling a `listbox`, each result is an `option` with a stable
 * id, the highlighted one carries `aria-selected="true"`, and the input's
 * `aria-activedescendant` follows the highlight while DOM focus stays in the
 * input. Group headings label `role="group"` containers; a pinnable row says
 * whether it is pinned in its accessible name.
 */

interface RecordGroup {
  entityType: string;
  label: string;
  status: 'ok' | 'unavailable';
  hits: Array<{ title: string; targetRoute: string }>;
}
let recordGroups: RecordGroup[] = [];
let recordState: 'ready' | 'loading' = 'ready';

// The server filters Actions by the query; the mock does the same, so a query
// matching nothing leaves the palette empty.
vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: (query: string) => ({
    actions: [
      {
        moduleId: 'orders',
        actionId: 'open-orders',
        label: 'Open orders',
        description: 'View orders',
        icon: 'Receipt',
        targetRoute: '/orders',
        keywords: [],
        weight: 1,
      },
      {
        moduleId: 'crm',
        actionId: 'new-opportunity',
        label: 'New opportunity',
        description: '',
        icon: 'Receipt',
        targetRoute: '/crm/opportunities/new',
        keywords: [],
        weight: 1,
      },
    ].filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase())),
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../../../packages/admin-shell/src/lib/global-search/useGlobalSearch', () => ({
  useGlobalSearch: (_open: boolean, query: string) => ({
    available: recordGroups.length > 0,
    state: recordState,
    searchedQuery: query.trim(),
    minimumQueryLength: 1,
    groups: recordGroups.map((group) => ({
      ...group,
      icon: 'Receipt',
      hasMore: false,
      hits: group.hits.map((hit) => ({ ...hit, subtitle: null, status: null })),
    })),
  }),
}));
vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));
vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

const en = realBundle('en').core!;

async function openPalette(): Promise<HTMLElement> {
  await act(async () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
  return screen.findByRole('dialog');
}

/** The option the combobox's `aria-activedescendant` names. */
function activeOption(input: HTMLElement): HTMLElement {
  const id = input.getAttribute('aria-activedescendant');
  if (!id) throw new Error('the combobox has no aria-activedescendant');
  const el = document.getElementById(id);
  if (!el) throw new Error(`aria-activedescendant names "${id}", which is not in the document`);
  return el;
}

function selectedOptions(listbox: HTMLElement): HTMLElement[] {
  return within(listbox)
    .getAllByRole('option')
    .filter((el) => el.getAttribute('aria-selected') === 'true');
}

beforeEach(() => {
  window.localStorage.clear();
  recordGroups = [];
  recordState = 'ready';
  vi.spyOn(apiClient, 'patch').mockImplementation(async (_path: string, body: unknown) => ({
    data: { sidebarPins: [], sidebarCollapsedGroups: [], sidebarRailMode: false, listPageSizes: {}, ...(body as object) },
  }));
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('command palette combobox semantics (#481)', () => {
  it('the input is a combobox that controls the results listbox', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    const input = within(dialog).getByRole('combobox');
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    const listbox = within(dialog).getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox.getAttribute('aria-label') ?? listbox.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('aria-activedescendant follows ArrowDown / ArrowUp and names the one selected option', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    const input = within(dialog).getByRole('combobox');
    const listbox = within(dialog).getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.length).toBeGreaterThan(2);

    const first = activeOption(input);
    expect(first.getAttribute('role')).toBe('option');
    expect(first).toBe(options[0]);
    expect(selectedOptions(listbox)).toEqual([first]);

    await act(async () => fireEvent.keyDown(window, { key: 'ArrowDown' }));
    const second = activeOption(input);
    expect(second).toBe(options[1]);
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(selectedOptions(listbox)).toEqual([second]);

    await act(async () => fireEvent.keyDown(window, { key: 'ArrowDown' }));
    expect(activeOption(input)).toBe(options[2]);

    await act(async () => fireEvent.keyDown(window, { key: 'ArrowUp' }));
    expect(activeOption(input)).toBe(options[1]);
    expect(selectedOptions(listbox)).toEqual([options[1]]);
    // Focus never leaves the input.
    expect(document.activeElement).toBe(input);
  });

  it('every option id is unique and stable across a highlight change', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    const listbox = within(dialog).getByRole('listbox');
    const before = within(listbox).getAllByRole('option').map((el) => el.id);
    expect(before.every(Boolean)).toBe(true);
    expect(new Set(before).size).toBe(before.length);
    await act(async () => fireEvent.keyDown(window, { key: 'ArrowDown' }));
    expect(within(listbox).getAllByRole('option').map((el) => el.id)).toEqual(before);
  });

  it('hovering a row moves aria-activedescendant to it', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    const input = within(dialog).getByRole('combobox');
    const target = within(dialog).getByRole('option', { name: /Open orders/ });
    fireEvent.mouseEnter(target);
    expect(activeOption(input)).toBe(target);
  });

  it('group headings label role=group containers', async () => {
    recordGroups = [
      { entityType: 'order', label: 'Orders', status: 'ok', hits: [{ title: 'Order SO-1', targetRoute: '/orders/o-1' }] },
    ];
    renderShell(AppShell);
    const dialog = await openPalette();
    await act(async () =>
      fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'o' } }),
    );
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Order SO-1/ })).toBeTruthy());
    const listbox = within(dialog).getByRole('listbox');
    const groups = within(listbox).getAllByRole('group');
    const names = groups.map((group) => {
      const ids = (group.getAttribute('aria-labelledby') ?? '').split(' ').filter(Boolean);
      return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    });
    expect(names).toContain(en['appShell.palette.group.actions']);
    expect(names.some((name) => name.startsWith('Orders'))).toBe(true);
    const ordersGroup = groups[names.findIndex((name) => name.startsWith('Orders'))]!;
    expect(within(ordersGroup).getByRole('option', { name: /Order SO-1/ })).toBeTruthy();
  });

  it('a pinnable row says whether it is pinned; other rows say nothing about pins', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders'] } });
    const dialog = await openPalette();
    const pinned = within(dialog).getByRole('option', { name: /Open orders/ });
    expect(pinned.textContent).toContain(en['appShell.palette.pin.statePinned']);
    expect(pinned.getAttribute('aria-keyshortcuts')).toBe('Alt+Enter');
    const home = within(dialog).getByRole('option', { name: /Home/ });
    expect(home.textContent).toContain(en['appShell.palette.pin.stateUnpinned']);
    const create = within(dialog).getByRole('option', { name: /New opportunity/ });
    expect(create.textContent).not.toContain(en['appShell.palette.pin.statePinned']);
    expect(create.textContent).not.toContain(en['appShell.palette.pin.stateUnpinned']);
    expect(create.hasAttribute('aria-keyshortcuts')).toBe(false);

    // Alt+Enter on the highlighted row flips the state its name carries.
    fireEvent.mouseEnter(pinned);
    await act(async () => fireEvent.keyDown(window, { key: 'Enter', altKey: true }));
    const after = within(dialog).getByRole('option', { name: /Open orders/ });
    expect(after.textContent).toContain(en['appShell.palette.pin.stateUnpinned']);
  });

  it('with nothing to show the listbox is gone and the combobox is collapsed', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    const input = within(dialog).getByRole('combobox');
    await act(async () => fireEvent.change(input, { target: { value: 'zzzz-no-such-thing' } }));
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(input.hasAttribute('aria-controls')).toBe(false);
    expect(within(dialog).getByText(en['appShell.search.noMatches']!)).toBeTruthy();
  });

  it('the record live region stays mounted inside the dialog', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    expect(within(dialog).getByTestId('palette-records-status').getAttribute('aria-live')).toBe('polite');
  });
});

describe('command palette axe check (#481)', () => {
  it('the open palette with a pinned and a highlighted row', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders'] } });
    const dialog = await openPalette();
    await act(async () => fireEvent.keyDown(window, { key: 'ArrowDown' }));
    await expectNoAxeViolations(dialog);
  });

  it('the open palette with record results, an unsearchable type and "see all"', async () => {
    recordGroups = [
      { entityType: 'order', label: 'Orders', status: 'ok', hits: [{ title: 'Order SO-1', targetRoute: '/orders/o-1' }] },
      { entityType: 'customer', label: 'Customers', status: 'unavailable', hits: [] },
    ];
    renderShell(AppShell);
    const dialog = await openPalette();
    await act(async () =>
      fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'o' } }),
    );
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Order SO-1/ })).toBeTruthy());
    await expectNoAxeViolations(dialog);
  });

  it('the open palette while records are still loading', async () => {
    recordGroups = [{ entityType: 'order', label: 'Orders', status: 'ok', hits: [] }];
    recordState = 'loading';
    renderShell(AppShell);
    const dialog = await openPalette();
    await act(async () =>
      fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'o' } }),
    );
    await expectNoAxeViolations(dialog);
  });

  it('the open palette with no matches', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    await act(async () =>
      fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'zzzz-no-such-thing' } }),
    );
    await expectNoAxeViolations(dialog);
  });
});
