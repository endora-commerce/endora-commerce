import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AuthProvider } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession } from '../../helpers/render-with-session';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import pl from '../../../../packages/modules/custom_fields/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import { askAudienceChange, audienceButton } from './row-actions';

/**
 * A custom-field definition declares who its values are answered to, and the
 * definition form is where an administrator says so.
 *
 * The default is the safe one: a field added without touching the control is
 * `internal`, so a note, a credit assessment or a risk flag modelled as a custom field
 * does not reach the customer because nobody thought to ask. Existing
 * definitions show the audience they have and can be moved either way.
 */

const create = vi.fn(async (_body: unknown) => ({}));
const update = vi.fn(async (_id: string, _patch: unknown) => ({}));

const EXISTING = {
  id: '00000000-0000-4000-8000-00000000cf01',
  entityType: 'organization',
  key: 'po_number',
  label: {},
  labelDefault: 'PO number',
  valueType: 'text',
  required: false,
  audience: 'customer',
  sortOrder: 0,
  config: {},
  options: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('../../../../packages/modules/custom_fields/src/admin/api/custom-fields-client', () => ({
  customFieldsClient: {
    listEntityTypes: async () => [
      { entityType: 'organization', labelKey: 'customFields.entity.organization' },
    ],
    list: async () => [EXISTING],
    create: (body: unknown) => create(body),
    update: (id: string, patch: unknown) => update(id, patch),
    remove: async () => ({}),
  },
}));

const { CustomFieldsPage } = await import(
  '../../../../packages/modules/custom_fields/src/admin/pages/CustomFieldsPage'
);

// The shipped English copy, so the assertions below read what an operator reads.
const EN = en as Record<string, string>;
const CORE = coreEn as Record<string, string>;
const BUNDLE = { custom_fields: EN, core: CORE };
const NEW_FIELD_AUDIENCE = 'Who can see the value';

/** The page reads `useAuth` for its write controls; this operator may write. */
const page = (
  <AuthProvider initial={adminSession({ permissions: ['custom_fields:read', 'custom_fields:write'] })}>
    <CustomFieldsPage />
  </AuthProvider>
);

/** Opens the definition form in its create view and fills what every new field needs (issue #447). */
async function openCreate(key: string): Promise<HTMLElement> {
  renderWithI18n(page, BUNDLE);
  fireEvent.click(await screen.findByRole('button', { name: 'New field' }));
  const dialog = await screen.findByRole('dialog', { name: 'New field' });
  fireEvent.change(within(dialog).getByPlaceholderText('po_number'), { target: { value: key } });
  fireEvent.change(within(within(dialog).getByRole('group', { name: 'Labels' })).getByLabelText('Default label'), {
    target: { value: key },
  });
  return dialog;
}

describe('CustomFieldsPage — the audience of a definition', () => {
  beforeEach(() => {
    create.mockClear();
    update.mockClear();
  });

  it('offers the choice with a plain explanation, internal by default', async () => {
    const dialog = await openCreate('internal_note');
    const select = within(dialog).getByLabelText(NEW_FIELD_AUDIENCE) as HTMLSelectElement;
    expect(select.value).toBe('internal');
    expect(select).toHaveAccessibleDescription(/Internal: administrators only\./);
    expect(
      within(dialog).getByText(/Customer-visible: also the storefront and the external API/),
    ).toBeInTheDocument();
  });

  it('creates an internal field when the choice is left alone', async () => {
    const dialog = await openCreate('internal_note');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ key: 'internal_note', audience: 'internal' });
  });

  it('creates a customer-visible field when the administrator says so', async () => {
    const dialog = await openCreate('gift_note');
    fireEvent.change(within(dialog).getByLabelText(NEW_FIELD_AUDIENCE), {
      target: { value: 'customer' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ key: 'gift_note', audience: 'customer' });
  });

  it('shows the audience of an existing field and lets it be changed', async () => {
    renderWithI18n(page, BUNDLE);
    await screen.findByText('po_number');
    // A value edited from the row is the kit StatusChangeControl (issue #1749): shown, then changed in a dialog.
    expect(audienceButton('po_number', EN, CORE).closest('div')).toHaveTextContent('Customer — shown to the customer');
    const confirm = await askAudienceChange('po_number', EN, CORE);
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Change to Internal — administrators only' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(EXISTING.id, { audience: 'internal' });
  });

  it('ships the choice and its explanation in Polish as well', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('customFields.audience.'));
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const key of keys) {
      const translated = (pl as Record<string, string>)[key];
      expect(translated, key).toBeTruthy();
      expect(translated, key).not.toBe((en as Record<string, string>)[key]);
    }
  });
});
