import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Ctrl/⌘+Shift+K focuses the Settings filter box.
 *
 * The settings list is long, so the filter is the primary way to reach a
 * given setting. The chord is shifted so it does not collide with the global
 * ⌘K command palette, whose handler skips shifted presses.
 */

vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: {
    list: vi.fn(async () => ({ groups: [] })),
  },
}));

// `SettingsPage` builds its sales-channel request itself since feature 091's
// P6 — it no longer imports `sales_channels`' admin API client, so the seam a
// test can isolate is `apiClient`. Partial, because the page also imports
// `ApiError` from the same module and compares against it with `instanceof`.
const channelsGetSpy = vi.fn(async () => ({ items: [] }));
// The **kit's** barrel, not `@/lib/api-client`. The screen is
// `@endora-commerce/mod-settings/admin`'s since feature 091's batch 10, so it
// resolves `apiClient` there; the admin's own path is a re-export shim of the
// same binding, and mocking a shim leaves the module the screen actually
// imports untouched.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, apiClient: { ...actual.apiClient, get: channelsGetSpy } };
});

const { SettingsPage } = await import(
  '../../../../packages/modules/settings/src/admin/pages/SettingsPage'
);

const bundle = passthroughBundle('settings', [
  'page.title',
  'page.description',
  'search.placeholder',
  'search.shortcut',
  'search.noResults',
  'context.label',
  'context.allChannels',
  'context.empty',
  'groups.expandAll',
  'groups.collapseAll',
  'state.loading',
]);

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error('settings search input not found');
  return input;
}

describe('SettingsPage — filter shortcut', () => {
  it('focuses the filter input on Ctrl+Shift+K', async () => {
    renderWithI18n(<SettingsPage />, bundle);
    await waitFor(() => expect(searchInput()).toBeTruthy());

    expect(document.activeElement).not.toBe(searchInput());

    const user = userEvent.setup();
    await user.keyboard('{Control>}{Shift>}K{/Shift}{/Control}');

    expect(document.activeElement).toBe(searchInput());
  });

  it('selects the existing query so the next keystroke replaces it', async () => {
    renderWithI18n(<SettingsPage />, bundle);
    await waitFor(() => expect(searchInput()).toBeTruthy());

    const user = userEvent.setup();
    await user.click(searchInput());
    await user.type(searchInput(), 'stock');
    expect(searchInput().value).toBe('stock');

    // Blur, then re-enter via the shortcut: the whole query is selected.
    searchInput().blur();
    await user.keyboard('{Control>}{Shift>}K{/Shift}{/Control}');

    const input = searchInput();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('stock'.length);
  });

  it('advertises the chord on the input and renders the hint', async () => {
    renderWithI18n(<SettingsPage />, bundle);
    await waitFor(() => expect(searchInput()).toBeTruthy());

    expect(searchInput().getAttribute('aria-keyshortcuts')).toBe(
      'Control+Shift+K Meta+Shift+K',
    );
    expect(document.querySelector('kbd')?.textContent).toBe('search.shortcut');
  });
});
