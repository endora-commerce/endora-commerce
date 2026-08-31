import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * Issue #112, follow-up — the top-nav notification bell is gated like every
 * other admin surface.
 *
 * The widened permission scanner found that `admin_notifications` had gated its
 * feed on `admin:read` since feature 026 while no manifest declared the code, so
 * only a `'*'` role could read it. Declaring the code made it grantable; it did
 * not make the surface honest. The bell still rendered for every authenticated
 * admin and polled the feed every 30 s, so an operator without the grant saw a
 * permanent bell that answered 403 — and an operator whose business had switched
 * `admin_notifications` off saw one that answered 503 (Principle XVII: a module
 * that is off contributes no widget).
 *
 * Both axes are asserted separately, because either one alone would let the
 * other regress unnoticed.
 */

let presentModules = new Set<string>();
let granted = new Set<string>();



vi.mock('@/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('@/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notification-bell" />,
}));

vi.mock('@/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('@/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

const coreBundle = passthroughBundle('core', [
  'appShell.brand.text',
  'appShell.search.placeholder',
  'appShell.search.openPalette',
  'appShell.search.shortcutSymbol',
  'appShell.nav.home',
]);

const { AppShell } = await import('../../src/components/AppShell');

function renderShell(opts: { permissions: readonly string[]; present: readonly string[] }): void {
  granted = new Set(opts.permissions);
  presentModules = new Set(opts.present);
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
      { session: adminSession({ permissions: [...granted] }), presence: modulePresence({ present: [...presentModules] }) },
    ),
    coreBundle,
  );
}

function bell(): Element | null {
  return document.querySelector('[data-testid="notification-bell"]');
}

describe('AppShell — the notification bell answers both gates (#112)', () => {
  it('renders for an operator who holds the grant while the module is present', () => {
    renderShell({ permissions: ['admin:read'], present: ['admin_notifications'] });
    expect(bell()).not.toBeNull();
  });

  it('is absent for an operator without the grant', () => {
    renderShell({ permissions: [], present: ['admin_notifications'] });
    expect(
      bell(),
      'a bell whose feed answers 403 is a control that advertises a capability the ' +
        'operator does not have',
    ).toBeNull();
  });

  it('is absent while the module is switched off, however broad the role', () => {
    renderShell({ permissions: ['*'], present: [] });
    expect(
      bell(),
      'Principle XVII — a module that is off contributes no widget, and the ' +
        'wildcard role is not an exception to that axis',
    ).toBeNull();
  });
});
