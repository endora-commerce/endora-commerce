import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { pinnedSection, renderShell, sidebar } from '../helpers/app-shell-preferences';

/**
 * Issue #1480 (UX audit SHELL-04) — the sidebar's own controls:
 *
 * - the search entry is a button that opens the command palette only when it
 *   is activated, never when focus merely lands on it (WCAG 3.2.1 On Focus),
 *   and it has an accessible name and advertises its shortcut;
 * - every collapsible group header exposes its state (`aria-expanded`) and
 *   names the region it controls (`aria-controls`), WCAG 4.1.2 — axe over
 *   the same sidebar runs in `AppShell.pinned.a11y.test.tsx`;
 * - the top bar carries no Help button that does nothing.
 */

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], isLoading: false, error: null }),
}));
vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));
vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(apiClient, 'patch').mockImplementation(async (_path: string, body: unknown) => ({
    data: { sidebarPins: [], sidebarCollapsedGroups: [], sidebarRailMode: false, listPageSizes: {}, ...(body as object) },
  }));
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function searchButton(): HTMLElement {
  return within(sidebar()).getByRole('button', { name: 'Search (⌘K)' });
}

describe('sidebar search entry (SHELL-04)', () => {
  it('is a named button advertising the palette shortcut, not a read-only input', () => {
    renderShell(AppShell);
    expect(sidebar().querySelector('input')).toBeNull();
    const button = searchButton();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+K Control+K');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('does not open the palette when it receives focus', async () => {
    renderShell(AppShell);
    await act(async () => {
      searchButton().focus();
      fireEvent.focus(searchButton());
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the palette when it is activated', async () => {
    renderShell(AppShell);
    await act(async () => fireEvent.click(searchButton()));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('is named in Polish too', () => {
    renderShell(AppShell, { language: 'pl' });
    expect(within(sidebar()).getByRole('button', { name: 'Szukaj (⌘K)' })).toBeTruthy();
  });
});

describe('collapsible sidebar groups (SHELL-04)', () => {
  function groupToggles(): HTMLElement[] {
    return [...sidebar().querySelectorAll<HTMLElement>('button.b2b-sidebar__group-label')];
  }

  it('every group header exposes aria-expanded and controls its item region', () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders'] } });
    const toggles = groupToggles();
    expect(toggles.length).toBeGreaterThan(1);
    for (const toggle of toggles) {
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      const controls = toggle.getAttribute('aria-controls');
      expect(controls, toggle.textContent ?? '').toBeTruthy();
      const region = document.getElementById(controls!);
      expect(region, controls!).not.toBeNull();
      expect(region!.classList.contains('b2b-sidebar__items')).toBe(true);
      expect(toggle.closest('.b2b-sidebar__group')!.contains(region)).toBe(true);
    }
    const ids = toggles.map((toggle) => toggle.getAttribute('aria-controls'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reflects a collapse in aria-expanded', async () => {
    renderShell(AppShell);
    const toggle = groupToggles()[0]!;
    await act(async () => fireEvent.click(toggle));
    const after = groupToggles()[0]!;
    expect(after.getAttribute('aria-expanded')).toBe('false');
    expect(after.closest('.b2b-sidebar__group')!.classList.contains('b2b-sidebar__group--collapsed')).toBe(true);
  });

  it('a group stored as collapsed renders aria-expanded=false', () => {
    renderShell(AppShell, {
      preferences: { sidebarPins: ['/orders'], sidebarCollapsedGroups: ['pinned'] },
    });
    const toggle = within(pinnedSection()!).getByRole('button', { name: 'Pinned' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('top bar (SHELL-04)', () => {
  it('offers no Help button that does nothing', () => {
    renderShell(AppShell);
    expect(screen.queryByRole('button', { name: 'Help' })).toBeNull();
  });
});
