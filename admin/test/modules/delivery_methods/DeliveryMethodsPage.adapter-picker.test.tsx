import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The adapter is the operator's choice on `/delivery-methods`.
 *
 * The screen only *displayed* a method's adapter. A method created there was
 * sent without one, the API defaulted it to the method's code, and a code no
 * module registered as an adapter gave a row that saved without a word and that
 * `GET /api/v1/delivery-methods` then dropped for good — measured on the public
 * demo with a method called `test`.
 *
 * Three things are held here: the choice is offered from the adapters the
 * instance has registered and is required for a new method; a row that cannot
 * be offered says so, and says what repairs it; and editing such a row never
 * rebinds it silently, while choosing a registered adapter does repair it.
 *
 * The module's real English bundle is mounted rather than a passthrough, so a
 * key the screen asks for and the bundle does not ship fails here as a raw
 * `delivery_methods.<key>` on screen.
 */

const here = dirname(fileURLToPath(import.meta.url));
const moduleBundle = JSON.parse(
  readFileSync(
    join(here, '../../../../packages/modules/delivery_methods/i18n/en.json'),
    'utf8',
  ),
) as Record<string, string>;

const CORE_KEYS = [
  'legacyMethods.delivery.title',
  'legacyMethods.delivery.description',
  'legacyMethods.delivery.empty',
  'legacyMethods.delivery.editTitle',
  'legacyMethods.columns.code',
  'legacyMethods.columns.name',
  'legacyMethods.columns.cost',
  'legacyMethods.columns.status',
  'legacyMethods.fields.code',
  'legacyMethods.fields.nameEn',
  'legacyMethods.fields.namePl',
  'legacyMethods.fields.cost',
  'legacyMethods.fields.currency',
  'legacyMethods.fields.status',
  'legacyMethods.status.active',
  'legacyMethods.status.inactive',
  'legacyMethods.formTitle',
  'legacyMethods.messages.saved',
  'legacyMethods.errors.save',
  'common.state.loading',
  'common.action.save',
  'common.action.cancel',
  'common.action.edit',
  'common.action.delete',
];

const BUNDLE = {
  core: Object.fromEntries(CORE_KEYS.map((k) => [k, k])),
  delivery_methods: moduleBundle,
};

const presentOwner = {
  id: 'delivery_methods',
  present: true,
  platformState: 'installed' as const,
  activated: true,
  deactivatable: true,
  nonDeactivatableReason: null,
};

function row(over: Record<string, unknown>) {
  return {
    id: '00000000-0000-4000-8000-00000000dd01',
    code: 'own_courier',
    adapter: 'manual_courier',
    name: { 'en-US': 'Courier' },
    cost: { amount: 12, currency: 'PLN' },
    status: 'active' as const,
    statusOnSuccess: 'shipment_sent',
    statusOnFailure: 'processing',
    salesChannelIds: [],
    rendererKey: null,
    availability: {
      ownerModule: 'delivery_methods',
      available: true,
      ownerPresence: presentOwner,
    },
    ...over,
  };
}

/** The demo's row: an adapter key no module ever registered. */
const ORPHAN = row({
  id: '00000000-0000-4000-8000-00000000dd02',
  code: 'test',
  adapter: 'test',
  name: { 'en-US': 'Test' },
  availability: { ownerModule: null, available: false, ownerPresence: null },
});

/** A carrier's row while the operator has that carrier module switched off. */
const CARRIER_OFF = row({
  id: '00000000-0000-4000-8000-00000000dd03',
  code: 'locker',
  adapter: 'acme_locker',
  name: { 'en-US': 'Locker' },
  availability: {
    ownerModule: 'acme_carrier',
    available: false,
    ownerPresence: { ...presentOwner, id: 'acme_carrier', present: false, activated: false },
  },
});

const REGISTERED = [
  { key: 'manual_courier', ownerModule: 'delivery_methods' },
  { key: 'personal_pickup', ownerModule: 'delivery_methods' },
  { key: 'acme_express', ownerModule: 'acme_carrier' },
];

const list = vi.fn();
const adapters = vi.fn();
const upsert = vi.fn();

vi.mock('../../../../packages/modules/delivery_methods/src/admin/api/delivery-methods-client', () => ({
  deliveryMethodsClient: {
    list: (...args: unknown[]) => list(...args),
    orderStatuses: vi.fn(async () => []),
    adapters: (...args: unknown[]) => adapters(...args),
    upsert: (...args: unknown[]) => upsert(...args),
    remove: vi.fn(),
  },
}));

// The currency picker reads the dictionary over HTTP and is `required`; with no
// currency to offer it would hold the form invalid for a reason that is not
// this file's subject. A one-option stand-in keeps native validation honest
// about the one field under test.
vi.mock('@endora-commerce/admin-kit/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CurrencyPicker: (props: Record<string, unknown>) => (
    <select {...props}>
      <option value="PLN">PLN</option>
    </select>
  ),
}));

async function mount(): Promise<void> {
  const { DeliveryMethodsPage } = await import(
    '../../../../packages/modules/delivery_methods/src/admin/pages/DeliveryMethodsPage'
  );
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/delivery-methods']}>
        <DeliveryMethodsPage />
      </MemoryRouter>,
      {
        session: adminSession({
          permissions: ['delivery_methods:read', 'delivery_methods:write'],
        }),
        presence: modulePresence({ present: ['delivery_methods'] }),
      },
    ),
    BUNDLE,
  );
}

function adapterSelect(): HTMLSelectElement {
  return screen.getByLabelText('Adapter') as HTMLSelectElement;
}

function optionTexts(): string[] {
  return within(adapterSelect())
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
}

function rowOf(code: string): HTMLElement {
  const cell = screen.getAllByText(code).find((el) => el.closest('tr') !== null);
  return cell!.closest('tr') as HTMLElement;
}

describe('the delivery-method adapter is chosen on the screen', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue([row({}), ORPHAN, CARRIER_OFF]);
    adapters.mockReset().mockResolvedValue(REGISTERED);
    upsert.mockReset().mockResolvedValue(row({}));
    // jsdom implements no scrolling; the edit handler asks for one.
    window.scrollTo = vi.fn();
  });

  it('offers the registered adapters, labelled where this module has a label and by key otherwise', async () => {
    await mount();
    await waitFor(() => expect(adapterSelect()).not.toBeDisabled());

    expect(optionTexts()).toEqual([
      'Choose an adapter…',
      'Own courier (manual) (manual_courier)',
      'Personal pickup (personal_pickup)',
      'acme_express',
    ]);
    // Nothing is preselected for a new method: the choice is the operator's.
    expect(adapterSelect().value).toBe('');
    expect(adapterSelect()).toBeRequired();
  });

  it('does not create a method until an adapter is chosen, then sends the chosen one', async () => {
    const user = userEvent.setup();
    await mount();
    await waitFor(() => expect(adapterSelect()).not.toBeDisabled());

    await user.type(screen.getByLabelText('legacyMethods.fields.code'), 'express');
    await user.click(screen.getByRole('button', { name: 'common.action.save' }));
    expect(upsert).not.toHaveBeenCalled();

    await user.selectOptions(adapterSelect(), 'acme_express');
    await user.click(screen.getByRole('button', { name: 'common.action.save' }));

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0]![0]).toBe('express');
    expect(upsert.mock.calls[0]![1]).toMatchObject({ code: 'express', adapter: 'acme_express' });
  });

  it('marks a row whose adapter nobody registered, and says what repairs it', async () => {
    await mount();
    await waitFor(() => expect(screen.getByText('own_courier')).toBeInTheDocument());

    const orphan = within(rowOf('test'));
    expect(orphan.getByText('Not offered at checkout')).toBeInTheDocument();
    expect(
      orphan.getByText(/not offered at checkout until it has a registered adapter/),
    ).toBeInTheDocument();

    // A row checkout does offer carries no mark at all.
    const healthy = within(rowOf('own_courier'));
    expect(healthy.queryByText('Not offered at checkout')).not.toBeInTheDocument();
    expect(healthy.getByText('Own courier (manual)')).toBeInTheDocument();
  });

  it('names the switched-off module for a row whose carrier is off', async () => {
    await mount();
    await waitFor(() => expect(screen.getByText('locker')).toBeInTheDocument());

    const carrier = within(rowOf('locker'));
    expect(carrier.getByText('Not offered at checkout')).toBeInTheDocument();
    expect(carrier.getByText(/"acme_carrier" module .* is switched off/)).toBeInTheDocument();
  });

  it('keeps an unavailable adapter selected when its row is opened, and flags it', async () => {
    const user = userEvent.setup();
    await mount();
    await waitFor(() => expect(screen.getByText('own_courier')).toBeInTheDocument());

    await user.click(within(rowOf('test')).getByRole('button', { name: 'common.action.edit' }));

    // Opening the row rebinds nothing: the adapter it has is still the value.
    expect(adapterSelect().value).toBe('test');
    expect(optionTexts()).toContain('test (not available)');
    expect(adapterSelect()).toHaveAttribute('aria-invalid', 'true');
    expect(adapterSelect()).toHaveAccessibleDescription(
      /"test" is not available in this instance.*Choose one of the listed adapters to repair it/,
    );
  });

  it('repairs the row by choosing a registered adapter', async () => {
    const user = userEvent.setup();
    await mount();
    await waitFor(() => expect(screen.getByText('own_courier')).toBeInTheDocument());

    await user.click(within(rowOf('test')).getByRole('button', { name: 'common.action.edit' }));
    await user.selectOptions(adapterSelect(), 'manual_courier');
    expect(adapterSelect()).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: 'common.action.save' }));

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0]![0]).toBe('test');
    expect(upsert.mock.calls[0]![1]).toMatchObject({ adapter: 'manual_courier' });
  });

  it('says so when the instance has no adapter at all', async () => {
    adapters.mockResolvedValue([]);
    list.mockResolvedValue([]);
    await mount();

    await waitFor(() =>
      expect(adapterSelect()).toHaveAccessibleDescription(
        /No adapter is registered in this instance/,
      ),
    );
    expect(optionTexts()).toEqual(['Choose an adapter…']);
  });

  it('tells a failed adapter read apart from an empty one, and retries it', async () => {
    const user = userEvent.setup();
    adapters.mockRejectedValueOnce(new Error('503'));
    await mount();

    await waitFor(() =>
      expect(screen.getByText('The list of adapters could not be loaded.')).toBeInTheDocument(),
    );
    // The methods themselves still render: one failed read is not a dead screen.
    expect(screen.getByText('own_courier')).toBeInTheDocument();
    expect(screen.queryByText(/No adapter is registered/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(optionTexts()).toContain('acme_express'));
    expect(screen.queryByText('The list of adapters could not be loaded.')).not.toBeInTheDocument();
  });

  it('does not flag an available adapter while the adapter read has failed', async () => {
    // "Not in a list that never arrived" is not "unavailable": the row says.
    const user = userEvent.setup();
    adapters.mockRejectedValue(new Error('503'));
    await mount();
    await waitFor(() => expect(screen.getByText('own_courier')).toBeInTheDocument());

    await user.click(
      within(rowOf('own_courier')).getByRole('button', { name: 'common.action.edit' }),
    );

    expect(adapterSelect().value).toBe('manual_courier');
    expect(optionTexts()).toContain('Own courier (manual)');
    expect(optionTexts().join('|')).not.toContain('not available');
    expect(adapterSelect()).not.toHaveAttribute('aria-invalid');
  });
});
