import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
// Issue #1519 — the screen mounts the `profile.security` zone, which reads the
// real session and presence providers; no contributor here.
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import enBundle from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03) — the profile is one form card whose
 * parts are sections, not three cards.
 *
 * Issue #1553 (SHELL-17) — and nothing beside it: the language preference had a
 * card and a second filled Save of its own, duplicating the top-bar
 * `LanguagePicker`. It is gone; one muted line says where the language is set.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual('@endora-commerce/admin-kit/lib');
  return {
    ...(actual as Record<string, unknown>),
    useAuth: () => ({ me: ME, refresh: async () => {}, logout: async () => {} }),
    apiClient: {
      get: vi.fn(async () => ({ data: { languages: [] } })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(async () => ({ data: {} })),
      delete: vi.fn(),
    },
  };
});

const ME = {
  adminUser: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
  role: { name: 'Operator' },
};

const { ProfilePage } = await import('../../../../packages/admin-shell/src/modules/profile/ProfilePage');

const core = enBundle as Record<string, string>;

function renderProfile(): void {
  renderWithI18n(withSession(<ProfilePage />, { session: adminSession({ permissions: ['*'] }), presence: modulePresence({}) }), { core });
}

describe('ProfilePage — sections in one card (DS-03)', () => {
  it('draws the form as one card of three sections, and no card inside a card', () => {
    renderProfile();
    const form = document.querySelector('form')!;
    const cards = form.querySelectorAll('[data-slot="card"]');
    expect(cards).toHaveLength(1);
    const sections = cards[0]!.querySelectorAll('[data-slot="editor-section"]');
    expect([...sections].map((s) => s.querySelector('h2')?.textContent)).toEqual([
      core['profile.identityTitle'],
      core['profile.authorTitle'],
      core['profile.changePassword'],
    ]);
    expect(document.querySelectorAll('[data-slot="card"] [data-slot="card"]')).toHaveLength(0);
    expect(document.querySelector('.b2b-card')).toBeNull();
  });

  it('has no language card of its own: the top-bar picker is the one place to change it (SHELL-17)', () => {
    renderProfile();
    // One Save on the page — the form's. Nothing outside the form is a button,
    // so there is no second filled primary competing with it (Von Restorff).
    const outside = [...document.querySelectorAll('button')].filter((button) => !button.closest('form'));
    expect(outside).toHaveLength(0);
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    expect(document.getElementById('profile-language')).toBeNull();
  });

  it('points to the top-bar language menu in one muted line inside the identity section', () => {
    renderProfile();
    const note = screen.getByText(core['profile.languageHelp']!);
    expect(note.tagName).toBe('P');
    expect(note.className).toContain('text-muted-foreground');
    const section = note.closest('[data-slot="editor-section"]');
    expect(section?.querySelector('h2')?.textContent).toBe(core['profile.identityTitle']);
  });
});
