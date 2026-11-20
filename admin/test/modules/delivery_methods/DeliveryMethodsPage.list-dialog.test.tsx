import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1543 (UX audit 2026-11-17, SALES-18): the delivery-methods screen drew
 * a "New / update method" form open above the list, and *Edit* on a row loaded
 * the row into it at the top of the page. The list comes first now; *New
 * method* in the header and *Edit* in the row's menu open the form in a dialog,
 * and *Delete* is the menu's last entry, confirmed. The two shipment-status
 * fields, hard-coded English before, are translated.
 *
 * The real `core` and `delivery_methods` bundles are mounted, so a key the
 * screen asks for and a bundle does not ship fails the lookups below.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(join(here, '../../../../packages/modules', path), 'utf8')) as Record<string, string>;
const BUNDLE = {
  core: read('_i18n/i18n/en.json'),
  delivery_methods: read('delivery_methods/i18n/en.json'),
};

function row(code: string): Record<string, unknown> {
  return {
    id: `id-${code}`,
    code,
    adapter: 'manual_courier',
    name: { 'en-US': `Method ${code}` },
    cost: { amount: 12, currency: 'PLN' },
    status: 'active' as const,
    statusOnSuccess: 'shipment_sent',
    statusOnFailure: 'processing',
    salesChannelIds: [],
    rendererKey: null,
    availability: { ownerModule: 'delivery_methods', available: true, ownerPresence: null },
  };
}

const list = vi.fn();
const upsert = vi.fn();
const remove = vi.fn();

vi.mock('../../../../packages/modules/delivery_methods/src/admin/api/delivery-methods-client', () => ({
  deliveryMethodsClient: {
    list: (...args: unknown[]) => list(...args),
    orderStatuses: vi.fn(async () => [
      { code: 'shipment_sent', label: 'Shipment sent' },
      { code: 'processing', label: 'Processing' },
    ]),
    adapters: vi.fn(async () => [{ key: 'manual_courier', ownerModule: 'delivery_methods' }]),
    upsert: (...args: unknown[]) => upsert(...args),
    remove: (...args: unknown[]) => remove(...args),
  },
}));

// The currency picker reads its dictionary over HTTP; a one-option stand-in
// keeps the required field valid without it.
vi.mock('@endora-commerce/admin-kit/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CurrencyPicker: (props: Record<string, unknown>) => (
    <select {...props}>
      <option value="PLN">PLN</option>
    </select>
  ),
}));

async function mount(
  permissions: string[] = ['delivery_methods:read', 'delivery_methods:write'],
): Promise<void> {
  const { DeliveryMethodsPage } = await import(
    '../../../../packages/modules/delivery_methods/src/admin/pages/DeliveryMethodsPage'
  );
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/delivery-methods']}>
        <DeliveryMethodsPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions }),
        presence: modulePresence({ present: ['delivery_methods'] }),
      },
    ),
    BUNDLE,
  );
}

function rowOf(code: string): HTMLElement {
  return screen.getAllByText(code).find((el) => el.closest('tr'))!.closest('tr') as HTMLElement;
}

beforeEach(() => {
  list.mockReset().mockResolvedValue([row('courier'), row('pickup')]);
  upsert.mockReset().mockResolvedValue(row('courier'));
  remove.mockReset().mockResolvedValue(undefined);
});

describe('delivery methods — the list comes first (SALES-18)', () => {
  it('draws no form until the operator asks for one', async () => {
    await mount();
    await waitFor(() => expect(screen.getByText('courier')).toBeInTheDocument());

    expect(document.querySelector('form')).toBeNull();
    expect(screen.getByRole('button', { name: 'New method' })).toBeInTheDocument();
  });

  it('shows the shipment-status mapping by status name, under a translated header', async () => {
    await mount();
    await waitFor(() => expect(screen.getByText('courier')).toBeInTheDocument());

    expect(screen.getByRole('columnheader', { name: 'Order status on success / failure' })).toBeInTheDocument();
    expect(within(rowOf('courier')).getByText('Shipment sent / Processing')).toBeInTheDocument();
  });

  it('creates a method in a dialog opened from the header, with translated status fields', async () => {
    const user = userEvent.setup();
    await mount();
    await waitFor(() => expect(screen.getByText('courier')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'New method' }));
    const dialog = screen.getByRole('dialog', { name: 'New delivery method' });
    const success = within(dialog).getByLabelText('Order status on shipment success');
    // The empty option names the status the server creates the method with.
    expect(within(success).getAllByRole('option')[0]).toHaveTextContent('Default (Shipment sent)');
    const failure = within(dialog).getByLabelText('Order status on shipment failure');
    expect(within(failure).getAllByRole('option')[0]).toHaveTextContent('Default (Processing)');

    await user.type(within(dialog).getByLabelText('Code'), 'express');
    await waitFor(() => expect(within(dialog).getByLabelText('Adapter')).not.toBeDisabled());
    await user.selectOptions(within(dialog).getByLabelText('Adapter'), 'manual_courier');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0]![0]).toBe('express');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Saved express.')).toBeInTheDocument();
  });

  it('opens the row in an edit dialog from its menu and keeps it open on a refused save', async () => {
    const user = userEvent.setup();
    upsert.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'DELIVERY_METHOD_IN_USE', message: 'In use.' } } as never),
    );
    await mount();
    await waitFor(() => expect(screen.getByText('pickup')).toBeInTheDocument());

    await user.click(within(rowOf('pickup')).getByRole('button', { name: 'Actions for pickup' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit method pickup' });
    expect(within(dialog).getByLabelText('Code')).toHaveValue('pickup');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('In use.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit method pickup' })).toBeInTheDocument();
  });

  it('puts Delete last in the row menu and asks before deleting', async () => {
    const user = userEvent.setup();
    await mount();
    await waitFor(() => expect(screen.getByText('pickup')).toBeInTheDocument());

    await user.click(within(rowOf('pickup')).getByRole('button', { name: 'Actions for pickup' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Edit', 'Delete']);

    await user.click(items[1]!);
    const confirm = await screen.findByRole('dialog');
    expect(confirm).toHaveTextContent('Delete this delivery method?');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('id-pickup'));
    await waitFor(() => expect(screen.queryByText('pickup')).toBeNull());
  });

  it('offers an operator who may only read neither New nor the row menu', async () => {
    await mount(['delivery_methods:read']);
    await waitFor(() => expect(screen.getByText('courier')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'New method' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for courier' })).toBeNull();
  });

  it('carries the one create action in the empty state while there is no method', async () => {
    list.mockResolvedValue([]);
    await mount();

    await waitFor(() => expect(screen.getByText('No delivery methods yet.')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'New method' })).toHaveLength(1);
  });
});
