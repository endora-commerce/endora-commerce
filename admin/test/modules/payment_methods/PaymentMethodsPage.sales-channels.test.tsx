import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Choosing the sales channels a payment method is offered in, on the
 * payment-methods screen: the list shows each method's channels, and the form
 * round-trips the selection through the method's own `PUT`.
 *
 * What the body carries is the contract with the API, so each case asserts the
 * `salesChannelIds` the client was handed — including the two cases where the
 * difference between `[]` and an absent key is the whole point:
 *
 *   - a **new** method saved with nothing ticked sends `[]`, "every channel",
 *     and not an absent key, which the API would read as "default channel only";
 *   - a form whose channel list could not be loaded sends **no key**, so the
 *     save cannot lift a restriction the operator was never shown.
 */

const CHANNEL_A = '00000000-0000-4000-8000-0000000000a1';
const CHANNEL_B = '00000000-0000-4000-8000-0000000000b1';

function row(code: string, salesChannelIds: string[]): Record<string, unknown> {
  return {
    id: `id-${code}`,
    code,
    adapter: 'bank_transfer',
    // Not the code: the list prints both, and a row is looked up by its code.
    name: { 'en-US': `Method ${code}` },
    status: 'active' as const,
    kind: 'bank_transfer' as const,
    additionalPrice: 0,
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'cancelled',
    availability: { ownerModule: 'payments', available: true, ownerPresence: null },
    salesChannelIds,
    rendererKey: null,
  };
}

const rows = [row('restricted_a', [CHANNEL_A]), row('unrestricted', [])];

const list = vi.fn(async () => rows);
const upsert = vi.fn(async (_code: string, _body: Record<string, unknown>) => rows[0]);

vi.mock('../../../../packages/modules/payment_methods/src/admin/api/payment-methods-client', () => ({
  paymentMethodsClient: {
    list: (...args: unknown[]) => list(...(args as [])),
    orderStatuses: vi.fn(async () => []),
    upsert: (...args: unknown[]) => upsert(...(args as [string, Record<string, unknown>])),
    remove: vi.fn(),
    adapters: vi.fn(async () => ['bank_transfer']),
    setStatus: vi.fn(),
  },
}));

/**
 * Answers the channel options — and only on **this module's own** route: a
 * request to the sales-channel admin route would be refused here, as it is for
 * an administrator who configures payment methods and does not hold that
 * permission.
 */
const channelsRequest = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (url: string) =>
        url === '/api/v1/admin/payment-methods/sales-channels'
          ? channelsRequest(url)
          : Promise.reject(new Error(`unexpected GET ${url}`)),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

function channel(id: string, code: string, name: string): Record<string, unknown> {
  return { id, code, name: { 'en-US': name }, active: true };
}

const CHANNELS = {
  data: [channel(CHANNEL_A, 'default', 'Default shop'), channel(CHANNEL_B, 'b2b-eu', 'B2B Europe')],
};

const BUNDLE = {
  core: {
    'methodSalesChannels.all': 'All channels',
    'methodSalesChannels.column': 'Sales channels',
    'methodSalesChannels.count': '{count} selected',
    'methodSalesChannels.helpAll': 'Offered in every sales channel.',
    'methodSalesChannels.helpSelected': 'Offered only in: {channels}.',
    'methodSalesChannels.inactiveOption': '{channel} (inactive)',
    'methodSalesChannels.label': 'Sales channels',
    'methodSalesChannels.loadError': 'The sales channels could not be loaded.',
    'methodSalesChannels.loading': 'Loading sales channels…',
    'methodSalesChannels.retry': 'Try again',
    'methodSalesChannels.search': 'Search sales channels…',
    'methodSalesChannels.unlisted': '{count} more',
    'common.action.edit': 'Edit',
    'common.action.save': 'Save',
    'legacyMethods.fields.code': 'Code',
  },
};

async function mount(): Promise<void> {
  const { PaymentMethodsPage } = await import(
    '../../../../packages/modules/payment_methods/src/admin/pages/PaymentMethodsPage'
  );
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/payment-methods']}>
        <PaymentMethodsPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['payment_methods:read', 'payment_methods:write'] }),
        presence: modulePresence({ present: ['payment_methods'] }),
      },
    ),
    BUNDLE,
  );
  await waitFor(() => expect(screen.getByText('restricted_a')).toBeInTheDocument());
}

/** The body the form handed the client on its one save. */
function savedBody(): Record<string, unknown> {
  expect(upsert).toHaveBeenCalledTimes(1);
  return upsert.mock.calls[0]![1];
}

/**
 * The sentence under the channel field. Looked up inside the field's own group:
 * a screen may carry other live regions, and this one is the field's.
 */
function channelsHelp(): HTMLElement {
  return within(screen.getByRole('group', { name: 'Sales channels' })).getByRole('status');
}

function save(): void {
  // `submit` rather than a click on Save: the form's other required fields are
  // not this file's subject, and jsdom does not run constraint validation on a
  // dispatched submit.
  fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);
}

beforeEach(() => {
  list.mockClear();
  upsert.mockClear();
  channelsRequest.mockReset();
  channelsRequest.mockResolvedValue(CHANNELS);
});

describe('payment-methods screen — sales channels', () => {
  it('shows each method’s channels in the list: names for a restricted one, "All channels" otherwise', async () => {
    await mount();

    const restricted = screen.getByText('restricted_a').closest('tr')!;
    await waitFor(() => expect(within(restricted).getByText('Default shop')).toBeInTheDocument());
    const unrestricted = screen.getByText('unrestricted').closest('tr')!;
    expect(within(unrestricted).getByText('All channels')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Sales channels' })).toBeInTheDocument();
  });

  it('round-trips an edited selection: the method’s channels are loaded, changed and saved', async () => {
    await mount();
    const user = userEvent.setup();

    await user.click(
      within(screen.getByText('restricted_a').closest('tr')!).getByRole('button', { name: 'Edit' }),
    );
    // The form opens on the method's current assignment.
    await waitFor(() =>
      expect(channelsHelp()).toHaveTextContent('Offered only in: Default shop.'),
    );

    await user.click(screen.getByRole('button', { name: 'Sales channels' }));
    await user.click(screen.getByRole('checkbox', { name: 'B2B Europe' }));
    save();

    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0]![0]).toBe('restricted_a');
    expect(savedBody()['salesChannelIds']).toEqual([CHANNEL_A, CHANNEL_B]);
  });

  it('saves an edit that unticks every channel as the empty set — every channel', async () => {
    await mount();
    const user = userEvent.setup();

    await user.click(
      within(screen.getByText('restricted_a').closest('tr')!).getByRole('button', { name: 'Edit' }),
    );
    await waitFor(() =>
      expect(channelsHelp()).toHaveTextContent('Offered only in: Default shop.'),
    );
    await user.click(screen.getByRole('button', { name: 'Sales channels' }));
    await user.click(screen.getByRole('checkbox', { name: 'Default shop' }));
    expect(channelsHelp()).toHaveTextContent('Offered in every sales channel.');
    save();

    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(savedBody()['salesChannelIds']).toEqual([]);
  });

  it('saves a new method with nothing chosen as the empty set, not as an absent field', async () => {
    await mount();
    const user = userEvent.setup();

    await waitFor(() =>
      expect(channelsHelp()).toHaveTextContent('Offered in every sales channel.'),
    );
    await user.type(screen.getByLabelText('Code'), 'brand_new');
    save();

    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0]![0]).toBe('brand_new');
    const body = savedBody();
    expect('salesChannelIds' in body).toBe(true);
    expect(body['salesChannelIds']).toEqual([]);
  });

  it('omits the field when the channel list could not be loaded, so a save changes no assignment', async () => {
    channelsRequest.mockReset();
    channelsRequest.mockRejectedValue(new Error('403'));
    await mount();
    const user = userEvent.setup();

    await user.click(
      within(screen.getByText('restricted_a').closest('tr')!).getByRole('button', { name: 'Edit' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sales channels could not be loaded.',
    );
    save();

    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect('salesChannelIds' in savedBody()).toBe(false);
  });
});
