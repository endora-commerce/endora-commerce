import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { contributions } from '../../../../packages/modules/settings/src/admin/index';
import { SettingsSectionTabs } from '../../../../packages/modules/settings/src/admin/components/SettingsSectionTabs';

/**
 * Issue #1550 (UX audit SHELL-10, Hick and Miller) — Settings, Groups and
 * Cache are one place with three views, so they take one sidebar row and a tab
 * strip instead of three rows. The palette keeps all three destinations
 * (Principle XVI), which `check:palette-coverage` and the manifest hold.
 */
const BUNDLE = passthroughBundle('settings', ['tabs.settings', 'tabs.groups', 'tabs.cache']);

function renderTabs(path: string, permissions: string[]): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <SettingsSectionTabs />
      </MemoryRouter>,
      { session: adminSession({ permissions }), presence: modulePresence({ present: ['settings'] }) },
    ),
    BUNDLE,
  );
}

describe('settings navigation (#1550)', () => {
  it('contributes one sidebar row and keeps all three routes', () => {
    expect((contributions.nav ?? []).map((entry) => entry.to)).toEqual(['/settings']);
    expect((contributions.routes ?? []).map((route) => route.path)).toEqual([
      '/settings',
      '/settings/groups',
      '/settings/cache',
    ]);
  });

  it('shows the three views as tabs and selects the current one', () => {
    renderTabs('/settings/cache', ['settings:read', 'settings:write']);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['tabs.settings', 'tabs.groups', 'tabs.cache']);
    expect(tabs.map((tab) => tab.getAttribute('href'))).toEqual([
      '/settings',
      '/settings/groups',
      '/settings/cache',
    ]);
    expect(screen.getByRole('tab', { name: 'tabs.cache' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'tabs.settings' })).toHaveAttribute('aria-selected', 'false');
  });

  it('withholds the cache tab from an operator without the write code its route enforces', () => {
    renderTabs('/settings/groups', ['settings:read']);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'tabs.settings',
      'tabs.groups',
    ]);
    expect(screen.getByRole('tab', { name: 'tabs.groups' })).toHaveAttribute('aria-selected', 'true');
  });
});
