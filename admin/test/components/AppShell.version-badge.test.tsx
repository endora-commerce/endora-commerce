import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../setup';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { withLocalStorage } from '../helpers/with-local-storage';
import type { Bundle } from '../../../packages/admin-shell/src/i18n/types';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  withSession,
} from '../helpers/render-with-session';

/**
 * The header says which Endora Commerce release the instance runs.
 *
 * The number is the API's — `GET /api/v1/admin/platform-info`, the version of
 * the `@endora-commerce/platform` package the serving process loaded — and the
 * rule these cases hold is the other half of that: **when there is no number,
 * there is no badge.** Not a dash, not `0.0.0`, not a skeleton the width of a
 * version. A placeholder that looks like a version is the defect the health
 * payload carried for months.
 *
 * The seam is the shell's own one-function API module, which is what a test
 * outside the package can substitute by path.
 */

const getPlatformInfo = vi.fn<() => Promise<{ version: string | null }>>();

vi.mock('../../../packages/admin-shell/src/lib/platform-info/api', () => ({
  getPlatformInfo: () => getPlatformInfo(),
}));

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ enabled: false })),
  listUnseenPromptRequests: vi.fn(async () => ({ data: [] })),
}));

// Real sentences for the keys under test, so the assertions read what an
// operator reads and the `{version}` placeholder is proven to be substituted.
const coreBundle = {
  core: {
    'appShell.brand.text': 'Endora Commerce',
    'appShell.brand.dashboardLink': 'Go to dashboard',
    'appShell.brand.versionLabel': 'Endora Commerce version {version}',
  },
};

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

function renderShell(bundle: Bundle = coreBundle): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: everyDeclaredModule() }),
      },
    ),
    bundle,
  );
}

function badge(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.b2b-sidebar__brand-version');
}

/** Lets the mocked read settle, whichever way it settles. */
async function settled(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AppShell version badge', () => {
  beforeEach(() => {
    setMobileViewport(false);
    // A store that starts empty: the rail preference is read from it on mount.
    withLocalStorage();
    getPlatformInfo.mockReset();
  });

  it('shows the release with the wordmark, with a full accessible name', async () => {
    getPlatformInfo.mockResolvedValue({ version: '0.104.0' });
    renderShell();

    await waitFor(() => expect(badge()).not.toBeNull());
    const el = badge() as HTMLElement;

    // What a sighted operator reads, hidden from assistive technology…
    const visible = el.querySelector('[aria-hidden="true"]');
    expect(visible?.textContent).toBe('v0.104.0');
    // …and what a screen reader announces instead of a bare number.
    expect(screen.getByText('Endora Commerce version 0.104.0')).toBeInTheDocument();
    // The badge takes no pointer events; the link's tooltip spells it out.
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute(
      'title',
      'Endora Commerce version 0.104.0',
    );
  });

  /**
   * The brand link carries `aria-label`, which replaces its content as the
   * accessible name. A badge inside it would be announced by nothing.
   */
  it('sits beside the dashboard link, not inside it', async () => {
    getPlatformInfo.mockResolvedValue({ version: '0.104.0' });
    renderShell();

    await waitFor(() => expect(badge()).not.toBeNull());
    const link = screen.getByRole('link', { name: 'Go to dashboard' });

    expect(link.contains(badge())).toBe(false);
    expect(link.parentElement).toBe((badge() as HTMLElement).parentElement);
    // The row makes room for it only when there is one to make room for.
    expect(link.parentElement).toHaveClass('b2b-sidebar__brand-row--versioned');
  });

  it('renders nothing while the release is being read', async () => {
    getPlatformInfo.mockReturnValue(new Promise(() => {}));
    renderShell();
    await settled();

    expect(getPlatformInfo).toHaveBeenCalledTimes(1);
    expect(badge()).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toBeInTheDocument();
  });

  it.each([
    ['the read fails', (): Promise<never> => Promise.reject(new Error('404'))],
    ['the platform does not know its release', () => Promise.resolve({ version: null })],
    ['the answer is empty', () => Promise.resolve({ version: '' })],
    ['the answer is blank', () => Promise.resolve({ version: '   ' })],
    [
      'the answer is not the documented shape',
      () => Promise.resolve({} as unknown as { version: string | null }),
    ],
  ])('renders nothing when %s', async (_name, answer) => {
    getPlatformInfo.mockImplementation(answer);
    renderShell();
    await settled();

    expect(getPlatformInfo).toHaveBeenCalledTimes(1);
    expect(badge()).toBeNull();
    expect(document.querySelector('.b2b-sidebar__brand-row--versioned')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).not.toHaveAttribute('title');
    expect(document.body.textContent).not.toMatch(/0\.0\.0|\{version\}|versionLabel/);
  });

  /**
   * Bundles are served by the API, so a shell newer than the instance's stored
   * bundles asks for a key that is not there yet. The resolver answers with the
   * key itself; the badge must not print it where a number belongs.
   */
  it('falls back to the bare number when the sentence is not in the bundle', async () => {
    getPlatformInfo.mockResolvedValue({ version: '0.104.0' });
    renderShell({
      core: { 'appShell.brand.text': 'Endora Commerce', 'appShell.brand.dashboardLink': 'Go to dashboard' },
    });

    await waitFor(() => expect(badge()).not.toBeNull());
    const el = badge() as HTMLElement;

    expect(el.querySelector('[aria-hidden="true"]')?.textContent).toBe('v0.104.0');
    expect(el.textContent).toBe('v0.104.0v0.104.0');
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).not.toHaveAttribute('title');
    expect(document.body.innerHTML).not.toContain('versionLabel');
  });

  /**
   * Collapsed, the sidebar is 64px wide and the wordmark is gone, so the badge
   * is too (`theme.css` hides it under `.b2b-sidebar--rail`). The release stays
   * one hover away, in the tooltip the logo already had — which, with no
   * release, is still the wordmark it always was.
   */
  it('moves the release into the logo’s tooltip when the sidebar is collapsed', async () => {
    window.localStorage.setItem('b2b-admin.nav.rail-mode', '1');
    getPlatformInfo.mockResolvedValue({ version: '0.104.0' });
    renderShell();

    const link = screen.getByRole('link', { name: 'Go to dashboard' });
    expect(link).toHaveAttribute('title', 'Endora Commerce');
    await waitFor(() =>
      expect(link).toHaveAttribute('title', 'Endora Commerce version 0.104.0'),
    );
    expect(document.querySelector('.b2b-sidebar--rail')).not.toBeNull();
  });
});
