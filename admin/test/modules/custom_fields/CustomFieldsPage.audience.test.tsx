import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import en from '../../../../packages/modules/custom_fields/i18n/en.json';
import pl from '../../../../packages/modules/custom_fields/i18n/pl.json';

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
const BUNDLE = { custom_fields: en };
const NEW_FIELD_AUDIENCE = 'Who can see the value';

describe('CustomFieldsPage — the audience of a definition', () => {
  beforeEach(() => {
    create.mockClear();
    update.mockClear();
  });

  it('offers the choice with a plain explanation, internal by default', async () => {
    renderWithI18n(<CustomFieldsPage />, BUNDLE);
    const select = (await screen.findByLabelText(NEW_FIELD_AUDIENCE)) as HTMLSelectElement;
    expect(select.value).toBe('internal');
    expect(
      screen.getByText(/Internal values are shown to administrators only\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/also returned to the customer in the storefront and to integrations/),
    ).toBeInTheDocument();
  });

  it('creates an internal field when the choice is left alone', async () => {
    renderWithI18n(<CustomFieldsPage />, BUNDLE);
    fireEvent.change(screen.getByPlaceholderText('po_number'), { target: { value: 'internal_note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ key: 'internal_note', audience: 'internal' });
  });

  it('creates a customer-visible field when the administrator says so', async () => {
    renderWithI18n(<CustomFieldsPage />, BUNDLE);
    fireEvent.change(screen.getByPlaceholderText('po_number'), { target: { value: 'gift_note' } });
    fireEvent.change(await screen.findByLabelText(NEW_FIELD_AUDIENCE), {
      target: { value: 'customer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ key: 'gift_note', audience: 'customer' });
  });

  it('shows the audience of an existing field and lets it be changed', async () => {
    renderWithI18n(<CustomFieldsPage />, BUNDLE);
    const rowSelect = (await screen.findByLabelText(
      'Who can see the value of po_number',
    )) as HTMLSelectElement;
    expect(rowSelect.value).toBe('customer');
    fireEvent.change(rowSelect, { target: { value: 'internal' } });
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
