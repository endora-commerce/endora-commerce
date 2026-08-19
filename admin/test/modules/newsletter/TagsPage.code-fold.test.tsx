import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #239 — the newsletter tag/field code generator dropped `ł` outright.
 *
 * The screen derives a backend-valid code from the name the operator typed
 * when they leave the code box empty, and the derived code is what the tag is
 * addressed by from then on. A fold that deletes the letter rather than
 * folding it produces a code with a hole in it — `metody_p_atnosci` — which
 * the operator cannot connect to anything they typed.
 *
 * Owner's ruling of 2026-08-19: repair the fold so new codes are correct;
 * historical codes are not migrated.
 *
 * `Metody płatności` and `Usługa wysyłki` are shipped copy
 * (`appShell.nav.paymentMethods` and `newsletter.nav.provider` in the `pl`
 * bundles), not strings invented to fold nicely.
 */

const createTag = vi.fn(async (_input: unknown) => ({}));
const createCustomField = vi.fn(async (_input: unknown) => ({}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock('@/modules/newsletter/api/newsletter-client', () => ({
  newsletterClient: {
    listTags: async () => ({ items: [] }),
    listCustomFields: async () => ({ items: [] }),
    createTag: (input: unknown) => createTag(input),
    createCustomField: (input: unknown) => createCustomField(input),
  },
}));

const { TagsPage } = await import('@/modules/newsletter/pages/TagsPage');

function fill(placeholder: string, value: string): void {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

describe('Newsletter TagsPage — code derived from a Polish name (issue #239)', () => {
  it('folds ł to l when deriving a tag code from its name', async () => {
    renderWithI18n(<TagsPage />);
    fill('name', 'Metody płatności');
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));

    await waitFor(() => expect(createTag).toHaveBeenCalledTimes(1));
    expect(createTag).toHaveBeenCalledWith({
      code: 'metody_platnosci',
      name: 'Metody płatności',
    });
  });

  it('folds ł when deriving a custom field key from its label', async () => {
    renderWithI18n(<TagsPage />);
    fill('label', 'Usługa wysyłki');
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));

    await waitFor(() => expect(createCustomField).toHaveBeenCalledTimes(1));
    expect(createCustomField).toHaveBeenCalledWith({
      key: 'usluga_wysylki',
      label: 'Usługa wysyłki',
      type: 'text',
    });
  });
});
