import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomerGroup } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import en from '../../../../packages/modules/customer_accounts/i18n/en.json';
import core from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * The customer groups list (UX audit slice S2 — DS-05 #1439, DS-07 #1441,
 * DS-15 #1448). The screen used to draw its create form open above the rows
 * and a filled red *Delete* in every row. It is now the kit's `ListPage`: the
 * list first, *New customer group* in the header opening a dialog, *Edit* and
 * *Delete* in the row's menu, *Delete* last and confirmed, and an `EmptyState`
 * that carries the one create action while there is no group.
 */

installOffsetParentShim();

const list = vi.fn<() => Promise<CustomerGroup[]>>();
const upsert = vi.fn();
const remove = vi.fn();
let canWrite = true;

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    useAuth: () => ({ hasPermission: (code: string) => code === 'customer_groups:read' || canWrite }),
  };
});

vi.mock('../../../../packages/modules/customer_accounts/src/admin/api/customer-groups-client', () => ({
  customerGroupsClient: {
    list: () => list(),
    upsert: (...args: unknown[]) => upsert(...args),
    remove: (...args: unknown[]) => remove(...args),
  },
}));

const { CustomerGroupsPage } = await import(
  '../../../../packages/modules/customer_accounts/src/admin/pages/CustomerGroupsPage'
);

const group = (id: string, code: string, name: string): CustomerGroup =>
  ({ id, code, name, description: null }) as unknown as CustomerGroup;
const WHOLESALE = group('g1', 'wholesale', 'Wholesale');
const RETAIL = group('g2', 'retail', 'Retail');

const fill = (key: keyof typeof en, values: Record<string, string>): string =>
  Object.entries(values).reduce<string>((text, [k, v]) => text.replace(`{${k}}`, v), en[key]);

function mount(): void {
  renderWithI18n(<CustomerGroupsPage />, { customer_accounts: en, core });
}

beforeEach(() => {
  canWrite = true;
  list.mockReset().mockResolvedValue([WHOLESALE, RETAIL]);
  upsert.mockReset().mockResolvedValue(WHOLESALE);
  remove.mockReset().mockResolvedValue(undefined);
});

describe('CustomerGroupsPage — the list comes first (DS-05)', () => {
  it('draws one heading, no form above the list and one primary New in the header', async () => {
    mount();
    await screen.findByText('Wholesale');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
    const create = screen.getByRole('button', { name: en['groups.action.new'] });
    expect(create).toHaveClass('bg-primary');
    // No other filled button competes with it (Von Restorff).
    expect(document.querySelectorAll('button.bg-primary, button.bg-destructive')).toHaveLength(1);
  });

  it('creates a group in a dialog, proposing the code from the name', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Wholesale');
    await user.click(screen.getByRole('button', { name: en['groups.action.new'] }));
    const dialog = await screen.findByRole('dialog', { name: en['groups.form.newTitle'] });
    await user.type(within(dialog).getByRole('textbox', { name: en['groups.field.name'] }), 'Key accounts');
    expect(within(dialog).getByRole('textbox', { name: en['groups.field.code'] })).toHaveValue('key_accounts');
    await user.click(within(dialog).getByRole('button', { name: en['groups.action.save'] }));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith('key_accounts', { code: 'key_accounts', name: 'Key accounts', description: null }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('refuses a code another group already has, instead of overwriting it', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Wholesale');
    await user.click(screen.getByRole('button', { name: en['groups.action.new'] }));
    const dialog = await screen.findByRole('dialog', { name: en['groups.form.newTitle'] });
    await user.type(within(dialog).getByRole('textbox', { name: en['groups.field.name'] }), 'Wholesale');
    await user.click(within(dialog).getByRole('button', { name: en['groups.action.save'] }));
    const code = within(dialog).getByRole('textbox', { name: en['groups.field.code'] });
    await waitFor(() => expect(code).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getByText(en['groups.error.codeTaken'])).toBeInTheDocument();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the server refusal and the typed values', async () => {
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    upsert.mockRejectedValue(new ApiError(400, { error: { code: 'VALIDATION_FAILED', message: 'Name too long.' } }));
    const user = userEvent.setup();
    mount();
    await screen.findByText('Wholesale');
    await user.click(screen.getByRole('button', { name: en['groups.action.new'] }));
    const dialog = await screen.findByRole('dialog', { name: en['groups.form.newTitle'] });
    await user.type(within(dialog).getByRole('textbox', { name: en['groups.field.name'] }), 'Partners');
    await user.click(within(dialog).getByRole('button', { name: en['groups.action.save'] }));
    expect(await within(dialog).findByText('Name too long.')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: en['groups.field.name'] })).toHaveValue('Partners');
  });

  it('edits from the row menu, prefilled, with the code locked', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Wholesale');
    await user.click(screen.getByRole('button', { name: fill('groups.rowActions', { name: 'Wholesale' }) }));
    await user.click(await screen.findByRole('menuitem', { name: en['groups.action.edit'] }));
    const dialog = await screen.findByRole('dialog', { name: fill('groups.form.editTitle', { code: 'wholesale' }) });
    const code = within(dialog).getByRole('textbox', { name: en['groups.field.code'] });
    expect(code).toHaveValue('wholesale');
    expect(code).toHaveAttribute('readonly');
    const name = within(dialog).getByRole('textbox', { name: en['groups.field.name'] });
    await user.clear(name);
    await user.type(name, 'Wholesale B2B');
    await user.click(within(dialog).getByRole('button', { name: en['groups.action.save'] }));
    await waitFor(() =>
      expect(upsert).toHaveBeenCalledWith('wholesale', { code: 'wholesale', name: 'Wholesale B2B', description: null }),
    );
  });

  it('opens the edit dialog from the group name too', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Wholesale' }));
    expect(await screen.findByRole('dialog', { name: fill('groups.form.editTitle', { code: 'wholesale' }) })).toBeInTheDocument();
  });
});

describe('CustomerGroupsPage — Delete sits in the row menu (DS-07)', () => {
  it('draws no Delete button in the row', async () => {
    mount();
    await screen.findByText('Wholesale');
    expect(screen.queryByRole('button', { name: en['groups.action.delete'] })).toBeNull();
  });

  it('deletes only after the confirmation and moves focus to the next row', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('Wholesale');
    await user.click(screen.getByRole('button', { name: fill('groups.rowActions', { name: 'Wholesale' }) }));
    await user.click(await screen.findByRole('menuitem', { name: en['groups.action.delete'] }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(fill('groups.action.delete.confirm', { code: 'wholesale' }));
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: en['groups.action.delete'] }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('g1'));
    await waitFor(() => expect(screen.queryByText('Wholesale')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retail' })).toHaveFocus());
  });

  it('says a refused delete inside the confirmation and keeps the row', async () => {
    remove.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    mount();
    await screen.findByText('Wholesale');
    await user.click(screen.getByRole('button', { name: fill('groups.rowActions', { name: 'Wholesale' }) }));
    await user.click(await screen.findByRole('menuitem', { name: en['groups.action.delete'] }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: en['groups.action.delete'] }));
    expect(await within(dialog).findByText(en['groups.error.delete'])).toBeInTheDocument();
    expect(screen.getByText('Wholesale')).toBeInTheDocument();
  });
});

describe('CustomerGroupsPage — states (DS-15)', () => {
  it('offers the first group from the empty state, which holds the one create action', async () => {
    list.mockResolvedValue([]);
    mount();
    const empty = await screen.findByText(en['groups.empty.title']);
    const block = empty.closest('[data-empty-state]')!;
    expect(block).toHaveAttribute('data-empty-state', 'no-data');
    expect(within(block as HTMLElement).getByText(en['groups.empty.body'])).toBeInTheDocument();
    const creates = screen.getAllByRole('button', { name: en['groups.action.new'] });
    expect(creates).toHaveLength(1);
    expect(block).toContainElement(creates[0]!);
  });

  it('says why a read-only operator has no create action', async () => {
    canWrite = false;
    list.mockResolvedValue([]);
    mount();
    expect(await screen.findByText(en['groups.empty.bodyReadOnly'])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en['groups.action.new'] })).toBeNull();
  });

  it('shows a read-only operator the rows without New, menus or edit buttons', async () => {
    canWrite = false;
    mount();
    await screen.findByText('Wholesale');
    expect(screen.queryByRole('button', { name: en['groups.action.new'] })).toBeNull();
    expect(screen.queryByRole('button', { name: fill('groups.rowActions', { name: 'Wholesale' }) })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wholesale' })).toBeNull();
  });

  it('says a failed load with a Retry that reads again', async () => {
    list.mockRejectedValueOnce(new Error('down'));
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText(en['groups.error.load'])).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Wholesale')).toBeInTheDocument();
  });
});
