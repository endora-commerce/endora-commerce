import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import enBundle from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Feature 171 (US6) — the author profile's *about me* is written one language at a
 * time behind language tabs; switching tabs keeps what was typed in the other
 * languages, and the save sends them all.
 */

const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual('@endora-commerce/admin-kit/lib');
  return {
    ...(actual as Record<string, unknown>),
    useAuth: () => ({ me: ME, refresh: async () => {} }),
    apiClient: {
      get: vi.fn(async () => ({
        data: {
          languages: [
            { code: 'pl-PL', label: 'Polski' },
            { code: 'en-US', label: 'English' },
          ],
        },
      })),
      post: vi.fn(),
      put: vi.fn(),
      patch: (path: string, body: unknown) => patchSpy(path, body),
      delete: vi.fn(),
    },
  };
});

const ME = {
  adminUser: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', bio: { 'pl-PL': 'Stary opis' } },
  role: { name: 'Operator' },
};

const { ProfilePage } = await import('../../../../packages/admin-shell/src/modules/profile/ProfilePage');

const bundle = enBundle as Record<string, string>;

describe('ProfilePage — about me per language (feature 171)', () => {
  beforeEach(() => {
    patchSpy.mockReset();
    patchSpy.mockResolvedValue({ data: {} });
  });

  it('switches the language of the text, keeps every language typed, and saves them all', async () => {
    renderWithI18n(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: () => {} }}>
        <ProfilePage />
      </AppLanguageContext.Provider>,
      { core: bundle },
    );

    const polishLabel = bundle['profile.field.bio']!.replace('{language}', 'Polski');
    const bio = (await screen.findByLabelText(polishLabel)) as HTMLTextAreaElement;
    expect(bio.value).toBe('Stary opis');
    fireEvent.change(bio, { target: { value: 'Piszę o narzędziach.' } });

    fireEvent.click(screen.getByRole('tab', { name: 'en-US' }));
    const english = (await screen.findByLabelText(
      bundle['profile.field.bio']!.replace('{language}', 'English'),
    )) as HTMLTextAreaElement;
    expect(english.value).toBe('');
    fireEvent.change(english, { target: { value: 'I write about tools.' } });

    fireEvent.click(screen.getByRole('tab', { name: 'pl-PL' }));
    expect(((await screen.findByLabelText(polishLabel)) as HTMLTextAreaElement).value).toBe('Piszę o narzędziach.');

    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
    expect(patchSpy.mock.calls[0]![1]).toEqual({
      bio: { 'pl-PL': 'Piszę o narzędziach.', 'en-US': 'I write about tools.' },
    });
  });
});
