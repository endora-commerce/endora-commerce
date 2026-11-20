import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * The taxes list (issue #1501, UX audit SHELL-14): the list comes first, the
 * upsert form opens from the header's *New tax rule* in a dialog instead of
 * being drawn open above the rows, and *Edit* / *Delete* sit in the row's
 * overflow menu, *Delete* last and confirmed.
 */

installOffsetParentShim();

const rule = {
  id: '00000000-0000-4000-8000-00000000dd02',
  code: 'vat_pl_23',
  name: 'VAT 23%',
  rate: 0.23,
  country: 'PL',
  productType: null,
  appliesToVatStatuses: ['vat_payer'],
  isDefault: false,
  priority: 5,
};

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => get(...args),
      put: (...args: unknown[]) => put(...args),
      delete: (...args: unknown[]) => del(...args),
    },
  };
});

const KEYS = [
  'taxes.page.title',
  'taxes.empty',
  'taxes.action.new',
  'taxes.action.edit',
  'taxes.action.delete',
  'taxes.action.save',
  'taxes.rowActions',
  'taxes.upsert.createTitle',
  'taxes.upsert.editTitle',
  'taxes.deleteConfirm',
  'taxes.field.code',
  'taxes.field.name',
  'taxes.field.rate',
  'taxes.field.priority',
  'taxes.success.save',
  'common.action.cancel',
];

const { TaxesPage } = await import('../../../../packages/modules/taxes/src/admin/pages/TaxesPage');

function mount(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/taxes']}>
        <TaxesPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['taxes:read', 'taxes:write'] }),
        presence: modulePresence({ present: ['taxes'] }),
      },
    ),
    passthroughBundle('core', KEYS),
  );
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  del.mockReset();
  get.mockResolvedValue({ data: [rule] });
  put.mockResolvedValue({ data: rule });
  del.mockResolvedValue(undefined);
});

describe('TaxesPage — the list comes first (SHELL-14)', () => {
  it('draws no form above the list and no delete button in the row', async () => {
    mount();
    await screen.findByText('vat_pl_23');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'taxes.action.delete' })).toBeNull();
  });

  it('creates a rule from the header button in a dialog', async () => {
    mount();
    await screen.findByText('vat_pl_23');
    await userEvent.click(screen.getByRole('button', { name: 'taxes.action.new' }));
    const dialog = await screen.findByRole('dialog', { name: 'taxes.upsert.createTitle' });
    await userEvent.type(within(dialog).getByLabelText('taxes.field.code'), 'vat_de_19');
    await userEvent.type(within(dialog).getByLabelText('taxes.field.name'), 'VAT DE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'taxes.action.save' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/v1/admin/taxes/vat_de_19', expect.objectContaining({ code: 'vat_de_19', name: 'VAT DE' })),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('taxes.success.save')).toBeInTheDocument();
  });

  // Issue #1499 (UX audit SALES-17, DEC-12 a): the saved rule is said beside the
  // header button the dialog returns focus to, in a region mounted before it has
  // text, and not as a success banner above the list.
  it('says the saved rule beside "New rule", with no success banner', async () => {
    mount();
    await screen.findByText('vat_pl_23');
    const newRule = screen.getByRole('button', { name: 'taxes.action.new' });
    const region = within(newRule.parentElement!).getByRole('status');
    expect(region.textContent).toBe('');
    await userEvent.click(newRule);
    const dialog = await screen.findByRole('dialog', { name: 'taxes.upsert.createTitle' });
    await userEvent.type(within(dialog).getByLabelText('taxes.field.code'), 'vat_de_19');
    await userEvent.type(within(dialog).getByLabelText('taxes.field.name'), 'VAT DE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'taxes.action.save' }));
    await waitFor(() => expect(region).toHaveTextContent('taxes.success.save'));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });

  it('keeps the dialog open with the server refusal', async () => {
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    put.mockRejectedValue(new ApiError(400, { error: { code: 'VALIDATION_FAILED', message: 'Rate out of range.' } }));
    mount();
    await screen.findByText('vat_pl_23');
    await userEvent.click(screen.getByRole('button', { name: 'taxes.action.new' }));
    const dialog = await screen.findByRole('dialog', { name: 'taxes.upsert.createTitle' });
    await userEvent.type(within(dialog).getByLabelText('taxes.field.code'), 'bad');
    await userEvent.type(within(dialog).getByLabelText('taxes.field.name'), 'Bad');
    await userEvent.click(within(dialog).getByRole('button', { name: 'taxes.action.save' }));
    expect(await within(dialog).findByText('Rate out of range.')).toBeInTheDocument();
  });

  it('edits a rule from the row menu, prefilled, with the code locked', async () => {
    mount();
    await screen.findByText('vat_pl_23');
    await userEvent.click(screen.getByRole('button', { name: 'taxes.rowActions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'taxes.action.edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'taxes.upsert.editTitle' });
    const code = within(dialog).getByLabelText('taxes.field.code');
    expect(code).toHaveValue('vat_pl_23');
    expect(code).toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText('taxes.field.name')).toHaveValue('VAT 23%');
    expect(within(dialog).getByLabelText('taxes.field.priority')).toHaveValue(5);
    await userEvent.click(within(dialog).getByRole('button', { name: 'taxes.action.save' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/v1/admin/taxes/vat_pl_23',
        expect.objectContaining({ code: 'vat_pl_23', rate: 0.23, country: 'PL', appliesToVatStatuses: ['vat_payer'], priority: 5 }),
      ),
    );
  });

  it('deletes from the row menu only after the confirmation', async () => {
    mount();
    await screen.findByText('vat_pl_23');
    await userEvent.click(screen.getByRole('button', { name: 'taxes.rowActions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'taxes.action.delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('taxes.deleteConfirm');
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'taxes.action.delete' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(`/api/v1/admin/taxes/${rule.id}`));
  });

  it('offers creating the first rule from the empty state', async () => {
    get.mockResolvedValue({ data: [] });
    mount();
    expect(await screen.findByText('taxes.empty')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'taxes.action.new' })).toHaveLength(2);
  });
});
