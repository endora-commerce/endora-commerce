import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import enBundle from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03) — the profile is one form card whose
 * parts are sections, not three cards, and the language preference — saved on
 * its own — is the one card beside it. What the language Save answers is said
 * beside the button in an always-mounted status region, not in a `.b2b-card`
 * painted red or green inside the card (a frame inside a card, colour as the
 * only carrier, and a message no screen reader hears: WCAG 2.2 SC 1.4.1, 4.1.3).
 */

const setPreferredLanguageSpy = vi.fn();

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

vi.mock('@endora-commerce/admin-kit/i18n', async () => {
  const actual = await vi.importActual('@endora-commerce/admin-kit/i18n');
  return {
    ...(actual as Record<string, unknown>),
    useAppLanguage: () => ({ language: 'en', setLanguage: () => {} }),
    setPreferredLanguage: (language: string) => setPreferredLanguageSpy(language),
  };
});

const ME = {
  adminUser: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
  role: { name: 'Operator' },
};

const { ProfilePage } = await import('../../../../packages/admin-shell/src/modules/profile/ProfilePage');

const core = enBundle as Record<string, string>;

function renderProfile(): void {
  renderWithI18n(<ProfilePage />, { core });
}

function languageCard(): HTMLElement {
  return screen.getByRole('region', { name: core['profilePage.section.language']! });
}

describe('ProfilePage — sections in one card (DS-03)', () => {
  beforeEach(() => {
    setPreferredLanguageSpy.mockReset();
  });

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

  it('keeps the separately saved language preference as its own card, with a named select', () => {
    renderProfile();
    const card = languageCard();
    expect(card.getAttribute('data-slot')).toBe('card');
    expect(card.closest('form')).toBeNull();
    expect(within(card).getByRole('combobox', { name: core['profilePage.section.language']! })).toBeTruthy();
  });

  it('says what the language Save answered in a status region mounted before it, not a painted card', async () => {
    setPreferredLanguageSpy.mockRejectedValue(new Error('offline'));
    renderProfile();
    const card = languageCard();
    const status = within(card).getByRole('status');
    expect(status.textContent).toBe('');
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'pl' } });
    fireEvent.click(within(card).getByRole('button', { name: core['profilePage.language.action.save']! }));
    await waitFor(() => expect(status.textContent).toBe(core['profilePage.language.failed']));
    expect(status.getAttribute('data-tone')).toBe('error');
    expect(card.querySelector('[data-slot="card"]')).toBeNull();
  });
});
