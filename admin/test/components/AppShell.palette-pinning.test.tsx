import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { everyDeclaredModule, modulePresence, adminSession } from '../helpers/render-with-session';
import { pinnedSection, realBundle, renderShell } from '../helpers/app-shell-preferences';

/**
 * Feature 164, FR-027 — pinning from the ⌘K palette
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-client.md` §2.3;
 * research R-15, R-16; US1 AS-13 – AS-15).
 *
 * A result is pinnable when its destination **is** a visible sidebar entry's,
 * whichever group produced it. The palette's Navigate group holds only *Home*
 * today (every other screen arrives as a module's server Action), so the
 * Navigate case is *Home* and the server-Action case is `open-orders`, whose
 * control is named after the sidebar entry ("Orders"), not the action.
 */

interface ActionRow {
  moduleId: string;
  actionId: string;
  label: string;
  description: string;
  icon: string;
  targetRoute: string;
  keywords: string[];
  weight: number;
}
const action = (actionId: string, label: string, targetRoute: string, moduleId = 'orders'): ActionRow => ({
  moduleId,
  actionId,
  label,
  description: '',
  icon: 'Receipt',
  targetRoute,
  keywords: [],
  weight: 1,
});
let actions: ActionRow[] = [];
let recordHits: Array<{ title: string; targetRoute: string }> = [];

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions, isLoading: false, error: null }),
}));
vi.mock('../../../packages/admin-shell/src/lib/global-search/useGlobalSearch', () => ({
  useGlobalSearch: (_open: boolean, query: string) => ({
    available: recordHits.length > 0,
    state: 'ready',
    searchedQuery: query.trim(),
    minimumQueryLength: 1,
    groups:
      recordHits.length > 0
        ? [
            {
              entityType: 'order',
              label: 'Orders',
              icon: 'Receipt',
              hasMore: false,
              status: 'ok',
              hits: recordHits.map((hit) => ({ ...hit, subtitle: null, status: null })),
            },
          ]
        : [],
  }),
}));
vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: async () => ({ status: 'ready', bulkLimit: 500 }),
  listUnseenPromptRequests: async () => [],
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));
vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));
vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

const { AppShell, resetPromptCapabilityCacheForTesting } = await import(
  '../../../packages/admin-shell/src/components/AppShell'
);

const PREFS_URL = '/api/v1/admin/me/preferences';
let patchSpy: ReturnType<typeof vi.spyOn>;
const patchBodies = (): unknown[] =>
  (patchSpy.mock.calls as unknown[][]).filter(([path]) => path === PREFS_URL).map(([, body]) => body);

async function openPalette(): Promise<HTMLElement> {
  await act(async () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
  return screen.findByRole('dialog');
}

function rowOf(dialog: HTMLElement, text: string): HTMLElement {
  const row = [...dialog.querySelectorAll<HTMLElement>('.b2b-palette__item')].find((el) =>
    el.textContent?.includes(text),
  );
  if (!row) throw new Error(`no palette row reading "${text}"`);
  return row;
}

/**
 * The row's pin control. Issue #481 — a row is a `role="option"`, whose
 * children are presentational, so the control is a pointer shortcut hidden
 * from assistive technology (`Alt+Enter` is its keyboard path); the pin state
 * a screen reader hears is in the option's name.
 */
function pinControl(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>('[data-palette-pin]');
}

function pinControlOf(row: HTMLElement, title: string): HTMLElement {
  const control = pinControl(row);
  if (!control) throw new Error('no pin control in the row');
  expect(control.getAttribute('title')).toBe(title);
  return control;
}

function location(): string {
  return screen.getByTestId('location').textContent ?? '';
}

function groupCounts(dialog: HTMLElement): Array<[string, number]> {
  const counts: Array<[string, number]> = [];
  for (const el of dialog.querySelectorAll('.b2b-palette__group, .b2b-palette__item')) {
    if (el.classList.contains('b2b-palette__group')) counts.push([el.textContent ?? '', 0]);
    else if (counts.length > 0) counts[counts.length - 1]![1] += 1;
  }
  return counts;
}

beforeEach(() => {
  window.localStorage.clear();
  resetPromptCapabilityCacheForTesting();
  actions = [
    action('open-orders', 'Open orders', '/orders'),
    action('new-opportunity', 'New opportunity', '/crm/opportunities/new', 'crm'),
  ];
  recordHits = [];
  patchSpy = vi.spyOn(apiClient, 'patch').mockImplementation(async (_path: string, body: unknown) => ({
    data: { sidebarPins: [], sidebarCollapsedGroups: [], sidebarRailMode: false, listPageSizes: {}, ...(body as object) },
  }));
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('which palette rows are pinnable', () => {
  it('a Navigate row and a server Action whose destinations are sidebar entries get a pin button', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    const ordersRow = rowOf(dialog, 'Open orders');
    const orders = pinControlOf(ordersRow, 'Pin Orders');
    expect(orders.getAttribute('data-pinned')).toBe('false');
    expect(orders.getAttribute('aria-hidden')).toBe('true');
    expect(ordersRow.getAttribute('role')).toBe('option');
    expect(ordersRow.getAttribute('aria-keyshortcuts')).toBe('Alt+Enter');
    expect(pinControlOf(rowOf(dialog, 'Home'), 'Pin Home')).toBeTruthy();
  });

  it('a create action, the assistant row, a record and "see all" get none', async () => {
    recordHits = [{ title: 'Order SO-1', targetRoute: '/orders/o-1' }];
    renderShell(AppShell);
    const dialog = await openPalette();
    await act(async () => fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'o' } }));
    await waitFor(() => expect(rowOf(dialog, 'Order SO-1')).toBeTruthy());
    expect(pinControl(rowOf(dialog, 'Order SO-1'))).toBeNull();
    await act(async () => fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '' } }));
    expect(pinControl(rowOf(dialog, 'New opportunity'))).toBeNull();
    const assistantLabel = realBundle('en').prompt_actions!['palette.entry.label']!;
    await waitFor(() => expect(rowOf(dialog, assistantLabel)).toBeTruthy());
    expect(pinControl(rowOf(dialog, assistantLabel))).toBeNull();
    await act(async () => fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'so' } }));
    const seeAll = [...dialog.querySelectorAll<HTMLElement>('.b2b-palette__item')].at(-1)!;
    expect(seeAll.textContent).toContain('so');
    expect(pinControl(seeAll)).toBeNull();
  });

  it('no control when the destination module is off (US1 AS-14)', async () => {
    renderShell(AppShell, {
      presence: modulePresence({ present: everyDeclaredModule(), absent: ['orders'] }),
    });
    const dialog = await openPalette();
    expect(pinControl(rowOf(dialog, 'Open orders'))).toBeNull();
  });

  it('no control when the permission is withdrawn (US1 AS-14)', async () => {
    renderShell(AppShell, { session: adminSession({ permissions: ['prompt_actions:use'] }) });
    const dialog = await openPalette();
    expect(pinControl(rowOf(dialog, 'Open orders'))).toBeNull();
  });
});

describe('pinning from the palette', () => {
  it('a click pins without navigating or closing; focus stays in the input; the control flips (AS-13)', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/customers'] }, path: '/somewhere' });
    const dialog = await openPalette();
    const input = within(dialog).getByRole('combobox');
    expect(document.activeElement).toBe(input);
    const button = pinControlOf(rowOf(dialog, 'Open orders'), 'Pin Orders');
    await act(async () => {
      fireEvent.mouseDown(button);
      fireEvent.click(button);
    });
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(location()).toBe('/somewhere');
    expect(document.activeElement).toBe(input);
    const flipped = pinControlOf(rowOf(dialog, 'Open orders'), 'Unpin Orders');
    expect(flipped.getAttribute('data-pinned')).toBe('true');
    expect(within(pinnedSection()!).getAllByRole('link').map((el) => el.textContent)).toEqual([
      'Customers',
      'Orders',
    ]);
    await waitFor(() => expect(patchBodies()).toEqual([{ sidebarPins: ['/customers', '/orders'] }]));
    expect(within(dialog).getByTestId('palette-pin-status').textContent).toBe('Orders pinned');
  });

  it('Alt+Enter toggles the highlighted pinnable row and never navigates; Enter still opens it (AS-15)', async () => {
    renderShell(AppShell, { path: '/somewhere' });
    const dialog = await openPalette();
    // Highlight "Open orders".
    fireEvent.mouseEnter(rowOf(dialog, 'Open orders'));
    await act(async () => fireEvent.keyDown(window, { key: 'Enter', altKey: true }));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(location()).toBe('/somewhere');
    expect(pinControlOf(rowOf(dialog, 'Open orders'), 'Unpin Orders')).toBeTruthy();
    expect(within(dialog).getByTestId('palette-pin-status').textContent).toBe('Orders pinned');
    await act(async () => fireEvent.keyDown(window, { key: 'Enter', altKey: true }));
    expect(pinControlOf(rowOf(dialog, 'Open orders'), 'Pin Orders')).toBeTruthy();
    expect(within(dialog).getByTestId('palette-pin-status').textContent).toBe('Orders unpinned');
    await act(async () => fireEvent.keyDown(window, { key: 'Enter' }));
    expect(location()).toBe('/orders');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Alt+Enter on a row without the control does nothing', async () => {
    renderShell(AppShell, { path: '/somewhere' });
    const dialog = await openPalette();
    fireEvent.mouseEnter(rowOf(dialog, 'New opportunity'));
    await act(async () => fireEvent.keyDown(window, { key: 'Enter', altKey: true }));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(location()).toBe('/somewhere');
    expect(patchSpy).not.toHaveBeenCalled();
    expect(pinnedSection()).toBeNull();
  });

  it('the highlighted pinnable row advertises the chord, and the input is described by the instructions', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    fireEvent.mouseEnter(rowOf(dialog, 'Open orders'));
    const en = realBundle('en').core!;
    expect(rowOf(dialog, 'Open orders').textContent).toContain(en['appShell.palette.pin.hintPin']!);
    const input = within(dialog).getByRole('combobox');
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    expect(describedBy.map((id) => document.getElementById(id)?.textContent)).toContain(
      en['appShell.palette.pin.instructions'],
    );
    // The announcement region is inside the modal dialog and mounted empty.
    expect(within(dialog).getByTestId('palette-pin-status').textContent).toBe('');
  });

  it('every palette group keeps its item count, pinned or not (FR-024)', async () => {
    renderShell(AppShell);
    const before = groupCounts(await openPalette());
    cleanup();
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders', '/'] } });
    const after = groupCounts(await openPalette());
    expect(after).toEqual(before);
  });
});
