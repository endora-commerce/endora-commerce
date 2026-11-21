import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedModuleBundle } from '../../helpers/core-bundle';

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
 * (`appShell.nav.paymentMethods` and `newsletter`'s own `nav.provider.label` in the `pl`
 * bundles), not strings invented to fold nicely.
 */

const createTag = vi.fn(async (_input: unknown) => ({}));
const createCustomField = vi.fn(async (_input: unknown) => ({}));

// The **kit's** barrel, not `@/lib/auth`. The screen is
// `@endora-commerce/mod-newsletter/admin`'s since feature 091's batch 11, so it
// resolves `useAuth` there; the admin's own path is a re-export shim of the same
// binding, and mocking a shim leaves the module the screen actually imports
// untouched.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, useAuth: () => ({ hasPermission: () => true }) };
});

vi.mock('../../../../packages/modules/newsletter/src/admin/api/newsletter-client', () => ({
  newsletterClient: {
    listTags: async () => ({ items: [] }),
    listCustomFields: async () => ({ items: [] }),
    createTag: (input: unknown) => createTag(input),
    createCustomField: (input: unknown) => createCustomField(input),
  },
}));

const { TagsPage } = await import(
  '../../../../packages/modules/newsletter/src/admin/pages/TagsPage'
);

// The shipped copy (issue #1463): the inputs are found by their labels.
const bundle = shippedModuleBundle('newsletter', 'en');
const copy = bundle.newsletter as Record<string, string>;
const label = (key: string): string => copy[key]!;

/** The add forms are dialogs opened from each section's header (issue #1439, DS-05). */
async function openDialog(addKey: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: label(addKey) }));
  return screen.getByRole('dialog');
}

function fill(dialog: HTMLElement, labelKey: string, value: string): void {
  fireEvent.change(within(dialog).getByRole('textbox', { name: label(labelKey) }), { target: { value } });
}

describe('Newsletter TagsPage — code derived from a Polish name (issue #239)', () => {
  it('folds ł to l when deriving a tag code from its name', async () => {
    renderWithI18n(<TagsPage />, bundle);
    const dialog = await openDialog('tags.add');
    fill(dialog, 'tags.field.name', 'Metody płatności');
    fireEvent.click(within(dialog).getByRole('button', { name: label('tags.add') }));

    await waitFor(() => expect(createTag).toHaveBeenCalledTimes(1));
    expect(createTag).toHaveBeenCalledWith({
      code: 'metody_platnosci',
      name: 'Metody płatności',
    });
  });

  it('folds ł when deriving a custom field key from its label', async () => {
    renderWithI18n(<TagsPage />, bundle);
    const dialog = await openDialog('fields.add');
    fill(dialog, 'fields.field.label', 'Usługa wysyłki');
    fireEvent.click(within(dialog).getByRole('button', { name: label('fields.add') }));

    await waitFor(() => expect(createCustomField).toHaveBeenCalledTimes(1));
    expect(createCustomField).toHaveBeenCalledWith({
      key: 'usluga_wysylki',
      label: 'Usługa wysyłki',
      type: 'text',
    });
  });
});
