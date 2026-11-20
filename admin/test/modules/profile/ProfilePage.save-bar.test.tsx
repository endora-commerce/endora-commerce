import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import enBundle from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #1449 (UX audit 2026-11-17, DS-19; SHELL-17) — the profile's one Save sits in the kit's
 * sticky bar at the end of the form, and what it answers is said there, beside it: the
 * refusal, the outcome and "Unsaved changes". The hand-styled banners at the top of the page,
 * out of view of the button that caused them, are gone.
 */

const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual('@endora-commerce/admin-kit/lib');
  return {
    ...(actual as Record<string, unknown>),
    useAuth: () => ({ me: ME, refresh: async () => {}, logout: async () => {} }),
    apiClient: {
      get: vi.fn(async () => ({ data: { languages: [] } })),
      post: vi.fn(),
      put: vi.fn(),
      patch: (path: string, body: unknown) => patchSpy(path, body),
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
  renderWithI18n(
    <AppLanguageContext.Provider value={{ language: 'en', setLanguage: () => {} }}>
      <ProfilePage />
    </AppLanguageContext.Provider>,
    { core },
  );
}

function saveBar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>('[data-slot="sticky-form-actions"]');
  if (bar === null) throw new Error('no save bar');
  return bar;
}

describe('ProfilePage — the one Save in the sticky bar', () => {
  beforeEach(() => {
    patchSpy.mockReset();
    patchSpy.mockResolvedValue({ data: {} });
  });

  it('puts the form Save in the sticky bar as the form’s submit', () => {
    renderProfile();
    const bar = saveBar();
    expect(bar).toHaveAttribute('data-desktop', 'sticky');
    const save = within(bar).getByRole('button', { name: core['profile.saveChanges']! });
    expect(save).toHaveAttribute('type', 'submit');
    expect(bar.closest('form')).not.toBeNull();
  });

  it('says "Unsaved changes" once a field differs from the account', () => {
    renderProfile();
    const hint = within(saveBar()).getByTestId('unsaved-changes-hint');
    expect(hint).toHaveTextContent('');
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Augusta' } });
    expect(hint).toHaveTextContent(core['form.unsavedChanges.hint']!);
  });

  it('says the outcome in the bar', async () => {
    renderProfile();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Augusta' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(within(saveBar()).getByRole('status')).toHaveTextContent(core['profile.info.updated']!));
  });

  it('says a refusal in the bar', async () => {
    patchSpy.mockRejectedValue(new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'The name is too long.' } }));
    renderProfile();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Augusta' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(within(saveBar()).getByRole('alert')).toHaveTextContent('The name is too long.'));
  });
});
