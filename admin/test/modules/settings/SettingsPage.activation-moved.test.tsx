import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SettingDto } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * D-36a item 2 — the Settings surface stops hosting activation controls.
 *
 * It keeps every other setting a module owns. What it must not keep is a second
 * place to flip activation: Constitution XVII requires **exactly one** control
 * per module, and the reason the control moved at all is that a module owning
 * the surface that toggles modules can switch itself out of reach.
 *
 * The row does not vanish — an operator who knows the setting by name still
 * finds it — it stops being a control and points at the screen that has one.
 */

const activationSetting: SettingDto = {
  id: '00000000-0000-4000-8000-000000000001',
  // `blog.activation` rather than `blog.enabled`: feature 074 gave the module
  // an activation code of its own, because the older `blog.enabled` is
  // channel-scoped and governs storefront URLs, not the module.
  code: 'blog.activation',
  name: 'Blog enabled',
  description: 'Whether the blog is available.',
  valueType: 'boolean',
  ownerModule: 'blog',
  salesChannelCodes: [],
  defaultValue: true,
  globalValue: null,
  valuesByChannel: [],
  version: '2026-08-01T00:00:00.000Z',
  hidden: false,
  editable: true,
  activationControl: true,
} as SettingDto;

vi.mock('@/modules/settings/api/settings-client', () => ({
  settingsClient: {
    list: vi.fn(async () => ({
      groups: [
        {
          code: 'blog',
          name: 'Blog',
          isSystemProtected: false,
          salesChannelCodes: [],
          settings: [activationSetting],
        },
      ],
    })),
  },
}));

// `SettingsPage` builds its sales-channel request itself since feature 091's
// P6 — it no longer imports `sales_channels`' admin API client, so the seam a
// test can isolate is `apiClient`. Partial, because the page also imports
// `ApiError` from the same module and compares against it with `instanceof`.
const channelsGetSpy = vi.fn(async () => ({ items: [] }));
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, apiClient: { ...actual.apiClient, get: channelsGetSpy } };
});

const { SettingsPage } = await import('@/modules/settings/pages/SettingsPage');

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
  'activation.managedOnPlatformScreen',
  'activation.openPlatformScreen',
]);

describe('SettingsPage — activation moved to /platform/modules', () => {
  it('renders the activation row as a pointer, not as a control', async () => {
    renderWithI18n(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
      bundle,
    );
    await waitFor(() => expect(screen.getByText('Blog enabled')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: 'activation.openPlatformScreen' });
    expect(link.getAttribute('href')).toBe('/platform/modules');
    expect(
      screen.queryByRole('button', { name: /activation/ }),
      'the Settings surface must not host a second activation control',
    ).toBeNull();
    // The batch save must not pick the row up either — the settings write path
    // refuses activation codes, so a saveable-looking row could only ever fail.
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
