import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../helpers/render-with-session';
import {
  migrateCollapsedGroups,
  orderSectionItems,
  resolveSectionKey,
  toggleCollapsedGroup,
} from '../../../packages/admin-shell/src/components/sidebar/nav-sections';
import type { NavItem } from '../../../packages/admin-shell/src/components/sidebar/nav-types';

/**
 * Issue #1519 (UX audit SHELL-11, owner decision DEC-02): the eighteen-row
 * *System* section is two sections, *Access* and *Platform*, and the admin's
 * own two-step verification is a Profile tab rather than a sidebar row.
 *
 * Presence is seeded with every module the shell's declarations name, as in
 * `AppShell.analytics-nav.test.tsx`; the off-state of each row is its own
 * module's file.
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

const coreBundle = passthroughBundle('core', [
  'appShell.brand.text',
  'appShell.section.access',
  'appShell.section.platform',
]);

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

/** Who may sign in and what they may do — identities, their rights, machine secrets, the record. */
const ACCESS = ['/admin-users', '/admin-roles', '/api-keys', '/credentials', '/audit-log'];

/**
 * How the instance is configured and extended, frequent configuration first and
 * the developer tools last (Serial Position) — the host's three rows interleaved
 * with the contributions by weight rather than stacked above them.
 */
const PLATFORM = [
  '/platform/modules',
  '/settings',
  '/custom-fields',
  '/import-export',
  '/catalog/bulk-operations',
  '/webhooks',
  '/global-search/configuration',
  '/settings/pwa',
  '/platform/command-hooks',
  '/api-description',
];

function renderShell(): void {
  setMobileViewport(false);
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: everyDeclaredModule() }) },
    ),
    coreBundle,
  );
}

function groupHrefs(labelKey: string): (string | null)[] {
  const heading = screen.getByRole('button', { name: labelKey });
  const group = heading.closest('.b2b-sidebar__group');
  expect(group).not.toBeNull();
  return [...(group as HTMLElement).querySelectorAll('a')].map((a) => a.getAttribute('href'));
}

describe('AppShell — Access and Platform replace System (issue #1519)', () => {
  it('renders an Access section of five rows, in order', () => {
    renderShell();
    expect(groupHrefs('appShell.section.access')).toEqual(ACCESS);
  });

  it('renders a Platform section of ten rows, host rows placed by weight', () => {
    renderShell();
    expect(groupHrefs('appShell.section.platform')).toEqual(PLATFORM);
  });

  it('renders no System heading and no sidebar row for two-step verification', () => {
    renderShell();
    expect(screen.queryByRole('button', { name: 'appShell.section.system' })).toBeNull();
    const hrefs = [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));
    expect(hrefs).not.toContain('/security');
    expect(hrefs).not.toContain('/profile/security');
  });
});

describe('nav-sections — the split, without losing what an admin had', () => {
  it("files a contribution still naming the deprecated 'system' under Platform", () => {
    expect(resolveSectionKey('system')).toBe('platform');
    expect(resolveSectionKey('access')).toBe('access');
    expect(resolveSectionKey('catalog')).toBe('catalog');
  });

  it('reads a folded System as both successors folded, keeping every other key', () => {
    expect(migrateCollapsedGroups(['sales', 'system', 'retired-elsewhere'])).toEqual([
      'sales',
      'access',
      'platform',
      'retired-elsewhere',
    ]);
    expect(migrateCollapsedGroups(['system', 'platform'])).toEqual(['access', 'platform']);
  });

  it('writes the successors back on the next toggle, so System cannot refold them', () => {
    expect(toggleCollapsedGroup(['system'], 'access')).toEqual(['platform']);
    expect(toggleCollapsedGroup(['system'], 'sales')).toEqual(['access', 'platform', 'sales']);
    expect(toggleCollapsedGroup([], 'platform')).toEqual(['platform']);
  });

  it('keeps unweighted host rows first and sorts weighted ones among the contributions', () => {
    const row = (to: string, weight?: number): NavItem => ({
      to,
      labelKey: to,
      icon: (() => null) as unknown as NavItem['icon'],
      module: null,
      ...(weight === undefined ? {} : { weight }),
    });
    const ordered = orderSectionItems(
      [row('/host-first'), row('/host-late', 900), row('/host-early', 100)],
      [
        { ...row('/a'), weight: 200 },
        { ...row('/b'), weight: 900 },
      ],
    );
    expect(ordered.map((item) => item.to)).toEqual(['/host-first', '/host-early', '/a', '/host-late', '/b']);
  });
});
