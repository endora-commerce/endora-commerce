import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { expectNoAxeViolations } from '../helpers/axe';
import { realBundle, renderShell } from '../helpers/app-shell-preferences';

/**
 * Issue #1404 — the ⌘K palette's "a prompt you confirmed earlier has finished"
 * notice (feature 043, FR-018) is an `option` of the results listbox, not a
 * mouse-only `div` above it: the arrow keys reach it, `aria-activedescendant`
 * names it, Enter opens the finished request in prompt mode, and its arrival
 * is announced in a live region mounted before it has text. The highlighted
 * option is also scrolled into view as the arrow keys move.
 */

interface UnseenRequest {
  id: string;
}
let unseenRequests: UnseenRequest[] = [];

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
    ].filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase())),
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../../../packages/admin-shell/src/lib/global-search/useGlobalSearch', () => ({
  useGlobalSearch: () => ({
    available: false,
    state: 'ready',
    searchedQuery: '',
    minimumQueryLength: 1,
    groups: [],
  }),
}));
vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: async () => ({ status: 'ready', bulkLimit: 500 }),
  listUnseenPromptRequests: async () => unseenRequests,
}));
// Prompt mode itself is covered elsewhere; here it only has to say which
// request it was opened on.
vi.mock('../../../packages/admin-shell/src/components/prompt-actions/PromptModePanel', () => ({
  PromptModePanel: ({ initialRequest }: { initialRequest?: UnseenRequest }) => (
    <div data-testid="prompt-mode-panel">{initialRequest?.id ?? 'none'}</div>
  ),
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

const notice = realBundle('en').prompt_actions!['panel.unseenNotice']!;
const noticePl = realBundle('pl').prompt_actions!['panel.unseenNotice']!;

async function openPalette(): Promise<HTMLElement> {
  await act(async () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
  return screen.findByRole('dialog');
}

function activeOption(input: HTMLElement): HTMLElement | null {
  const id = input.getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
}

let scrolled: Array<{ element: Element; options: unknown }> = [];

beforeEach(() => {
  window.localStorage.clear();
  resetPromptCapabilityCacheForTesting();
  unseenRequests = [];
  scrolled = [];
  // jsdom implements no `scrollIntoView`; record the calls instead.
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown): void {
    scrolled.push({ element: this, options });
  } as Element['scrollIntoView'];
  vi.spyOn(apiClient, 'patch').mockImplementation(async (_path: string, body: unknown) => ({
    data: { sidebarPins: [], sidebarCollapsedGroups: [], sidebarRailMode: false, listPageSizes: {}, ...(body as object) },
  }));
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe('command palette — finished-prompt notice (#1404)', () => {
  it('is the first option of the listbox, named, and highlighted on open', async () => {
    unseenRequests = [{ id: 'req-1' }];
    renderShell(AppShell);
    const dialog = await openPalette();
    const option = await within(dialog).findByRole('option', { name: notice });
    const listbox = within(dialog).getByRole('listbox');
    expect(listbox.contains(option)).toBe(true);
    expect(within(listbox).getAllByRole('option')[0]).toBe(option);
    const input = within(dialog).getByRole('combobox');
    expect(activeOption(input)).toBe(option);
    expect(option.getAttribute('aria-selected')).toBe('true');
    // Never a pin target: the row is not a sidebar destination.
    expect(option.hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('Enter on it opens prompt mode on the finished request', async () => {
    unseenRequests = [{ id: 'req-1' }];
    renderShell(AppShell);
    const dialog = await openPalette();
    await within(dialog).findByRole('option', { name: notice });
    await act(async () => fireEvent.keyDown(window, { key: 'Enter' }));
    await waitFor(() => expect(screen.getByTestId('prompt-mode-panel').textContent).toBe('req-1'));
  });

  it('is reachable with the arrow keys after moving away from it', async () => {
    unseenRequests = [{ id: 'req-1' }];
    renderShell(AppShell);
    const dialog = await openPalette();
    const option = await within(dialog).findByRole('option', { name: notice });
    const input = within(dialog).getByRole('combobox');
    await act(async () => fireEvent.keyDown(window, { key: 'ArrowDown' }));
    expect(activeOption(input)).not.toBe(option);
    await act(async () => fireEvent.keyDown(window, { key: 'ArrowUp' }));
    expect(activeOption(input)).toBe(option);
    expect(document.activeElement).toBe(input);
  });

  it('a click still opens it', async () => {
    unseenRequests = [{ id: 'req-2' }];
    renderShell(AppShell);
    const dialog = await openPalette();
    fireEvent.click(await within(dialog).findByRole('option', { name: notice }));
    await waitFor(() => expect(screen.getByTestId('prompt-mode-panel').textContent).toBe('req-2'));
  });

  it('its arrival is announced in a live region mounted beforehand', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    const status = within(dialog).getByTestId('palette-unseen-status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('');
    cleanup();

    unseenRequests = [{ id: 'req-1' }];
    renderShell(AppShell);
    const again = await openPalette();
    await waitFor(() => expect(within(again).getByTestId('palette-unseen-status').textContent).toBe(notice));
  });

  it('is filtered by the query like the assistant row', async () => {
    unseenRequests = [{ id: 'req-1' }];
    renderShell(AppShell);
    const dialog = await openPalette();
    await within(dialog).findByRole('option', { name: notice });
    const input = within(dialog).getByRole('combobox');
    await act(async () => fireEvent.change(input, { target: { value: 'orders' } }));
    expect(within(dialog).queryByRole('option', { name: notice })).toBeNull();
    await act(async () => fireEvent.change(input, { target: { value: 'asystent' } }));
    expect(within(dialog).getByRole('option', { name: notice })).toBeTruthy();
  });

  it('ships in Polish', async () => {
    unseenRequests = [{ id: 'req-1' }];
    renderShell(AppShell, { language: 'pl' });
    const dialog = await openPalette();
    expect(await within(dialog).findByRole('option', { name: noticePl })).toBeTruthy();
  });
});

describe('command palette — highlighted row is kept in view (#1404)', () => {
  it('scrolls the active descendant into view with block: nearest as the arrow keys move', async () => {
    renderShell(AppShell);
    const dialog = await openPalette();
    const input = within(dialog).getByRole('combobox');
    scrolled = [];
    await act(async () => fireEvent.keyDown(window, { key: 'ArrowDown' }));
    await act(async () => fireEvent.keyDown(window, { key: 'ArrowDown' }));
    const active = activeOption(input);
    expect(active).not.toBeNull();
    const last = scrolled[scrolled.length - 1];
    expect(last?.element).toBe(active);
    expect(last?.options).toEqual({ block: 'nearest' });
  });
});

describe('command palette — finished-prompt notice axe check (#1404)', () => {
  it('the open palette with the notice highlighted', async () => {
    unseenRequests = [{ id: 'req-1' }];
    renderShell(AppShell);
    const dialog = await openPalette();
    await within(dialog).findByRole('option', { name: notice });
    await expectNoAxeViolations(dialog);
  });
});
