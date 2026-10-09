import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminMe } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../setup';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, everyDeclaredModule, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * Issue #140 — an administrator that holds no role is told so by the shell.
 *
 * Such an account signs in normally: `GET /api/v1/admin/me` answers 200 with
 * `role: null` and `permissions: []`
 * (`backend/test/contract/admin_users/role-required.test.ts` pins that), so the
 * shell mounts, every permission-gated surface filters itself out, and what is
 * left is a panel with nothing in it. The sentence that explains it —
 * `ADMIN_ROLE_REQUIRED` — is carried by a 403 that only a page call produces,
 * and a panel with no reachable page makes no page call.
 *
 * The pair below is the property: the notice is there for a role-less session
 * and absent for one that holds a role. The second case is the control that
 * stops the first from passing on a notice rendered unconditionally.
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

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

const NOTICE_KEYS = ['appShell.noRole.title', 'appShell.noRole.description'] as const;

const coreBundle = passthroughBundle('core', [...NOTICE_KEYS, 'appShell.nav.home']);

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

/** The payload `/admin/me` answers for an account whose `admin_role_id` is null. */
function roleLessSession(): AdminMe {
  const base = adminSession({ permissions: [] });
  return { ...base, adminUser: { ...base.adminUser, adminRoleId: null }, role: null };
}

function renderShell(session: AdminMe): void {
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
      { session, presence: modulePresence({ present: everyDeclaredModule() }) },
    ),
    coreBundle,
  );
}

describe('AppShell — an administrator without a role is told why the panel is empty (issue #140)', () => {
  it('announces the notice to a session whose role is null', () => {
    renderShell(roleLessSession());

    // `role="alert"` is what makes the sentence reach a screen-reader user who
    // did nothing to trigger it; a styled `<div>` would be visible and silent.
    const notice = screen.getByRole('alert');
    expect(within(notice).getByText('appShell.noRole.title')).toBeInTheDocument();
    expect(within(notice).getByText('appShell.noRole.description')).toBeInTheDocument();
    // In the content area, above the routed screen rather than instead of it:
    // the profile page and sign-out stay reachable.
    expect(notice.closest('main')).not.toBeNull();
    expect(screen.getByText('Home content')).toBeInTheDocument();
  });

  it('shows nothing of the kind to a session that holds a role', () => {
    renderShell(adminSession({ permissions: [] }));

    expect(screen.queryByText('appShell.noRole.title')).toBeNull();
    expect(screen.queryByText('appShell.noRole.description')).toBeNull();
    expect(screen.getByText('Home content')).toBeInTheDocument();
  });

  it('ships both sentences in English and in Polish', () => {
    const bundle = (language: string): Record<string, string> =>
      JSON.parse(
        readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8'),
      ) as Record<string, string>;
    const en = bundle('en');
    const pl = bundle('pl');

    for (const key of NOTICE_KEYS) {
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(pl[key], `pl ${key}`).toBeTruthy();
      expect(pl[key], `pl ${key} is a translation, not a copy`).not.toBe(en[key]);
    }
  });
});
