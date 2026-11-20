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
 * Issue #1543 (UX audit 2026-11-17, SALES-18): the payment-methods screen drew
 * a "New / update method" form open above the list, and *Edit* on a row loaded
 * the row into that form at the top of the page, far from the row it came
 * from. The list comes first now; *New method* in the header and *Edit* in the
 * row's menu open the same form in a dialog, and *Delete* is the menu's last
 * entry, confirmed.
 *
 * The real `core` bundle is mounted, so a key the screen asks for and the
 * bundle does not ship shows as a raw key and fails the lookups below.
 */

const here = dirname(fileURLToPath(import.meta.url));
const core = JSON.parse(
  readFileSync(join(here, '../../../../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const BUNDLE = { core };

function row(code: string): Record<string, unknown> {
  return {
    id: `id-${code}`,
    code,
    adapter: 'bank_transfer',
    name: { 'en-US': `Method ${code}` },
    status: 'active' as const,
    kind: 'bank_transfer' as const,
    additionalPrice: 0,
    statusOnPending: '',
    statusOnSuccess: '',
    statusOnFailure: '',
    availability: { ownerModule: 'payments', available: true, ownerPresence: null },
    salesChannelIds: [],
    rendererKey: null,
  };
}

const list = vi.fn();
const upsert = vi.fn();
const remove = vi.fn();

vi.mock('../../../../packages/modules/payment_methods/src/admin/api/payment-methods-client', () => ({
  paymentMethodsClient: {
    list: (...args: unknown[]) => list(...args),
    orderStatuses: vi.fn(async () => []),
    upsert: (...args: unknown[]) => upsert(...args),
    remove: (...args: unknown[]) => remove(...args),
    adapters: vi.fn(async () => ['bank_transfer']),
    setStatus: vi.fn(),
  },
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async () => ({ data: [] })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

async function mount(permissions: string[] = ['payment_methods:read', 'payment_methods:write']): Promise<void> {
  const { PaymentMethodsPage } = await import(
    '../../../../packages/modules/payment_methods/src/admin/pages/PaymentMethodsPage'
  );
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/payment-methods']}>
        <PaymentMethodsPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions }),
        presence: modulePresence({ present: ['payment_methods'] }),
      },
    ),
    BUNDLE,
  );
}

function rowOf(code: string): HTMLElement {
  return screen.getAllByText(code).find((el) => el.closest('tr'))!.closest('tr') as HTMLElement;
}

async function openRowMenu(code: string): Promise<void> {
  await userEvent.click(within(rowOf(code)).getByRole('button', { name: `Actions for ${code}` }));
}

beforeEach(() => {
  list.mockReset().mockResolvedValue([row('transfer'), row('cash')]);
  upsert.mockReset().mockResolvedValue(row('transfer'));
  remove.mockReset().mockResolvedValue(undefined);
});

describe('payment methods — the list comes first (SALES-18)', () => {
  it('draws no form until the operator asks for one', async () => {
    await mount();
    await waitFor(() => expect(screen.getByText('transfer')).toBeInTheDocument());

    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByText('New / update method')).toBeNull();
    expect(screen.getByRole('button', { name: 'New method' })).toBeInTheDocument();
  });

  it('opens a blank create dialog from the header and saves it', async () => {
    const user = userEvent.setup();
    await mount();
    await waitFor(() => expect(screen.getByText('transfer')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'New method' }));
    const dialog = screen.getByRole('dialog', { name: 'New payment method' });
    expect(within(dialog).getByLabelText('Code')).toHaveValue('');

    await user.type(within(dialog).getByLabelText('Code'), 'card');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0]![0]).toBe('card');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The result is said beside the header action the dialog returned focus to.
    expect(screen.getByText('Saved card.')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });

  it('opens the row in an edit dialog from its menu, seeded with the row', async () => {
    const user = userEvent.setup();
    await mount();
    await waitFor(() => expect(screen.getByText('cash')).toBeInTheDocument());

    await openRowMenu('cash');
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit method cash' });
    expect(within(dialog).getByLabelText('Code')).toHaveValue('cash');
    expect(within(dialog).getByLabelText('Code')).toBeDisabled();
    expect(within(dialog).getByLabelText('Name [en-US]')).toHaveValue('Method cash');
  });

  it('keeps the dialog open and says why when the save is refused', async () => {
    const user = userEvent.setup();
    upsert.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'CONFLICT', message: 'Code already taken.' } } as never),
    );
    await mount();
    await waitFor(() => expect(screen.getByText('transfer')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'New method' }));
    const dialog = screen.getByRole('dialog', { name: 'New payment method' });
    await user.type(within(dialog).getByLabelText('Code'), 'transfer');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('Code already taken.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New payment method' })).toBeInTheDocument();
  });

  it('puts Delete last in the row menu, after a separator, and asks before deleting', async () => {
    const user = userEvent.setup();
    await mount();
    await waitFor(() => expect(screen.getByText('cash')).toBeInTheDocument());

    await openRowMenu('cash');
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Edit', 'Delete']);
    expect(screen.getByRole('separator')).toBeInTheDocument();

    await user.click(items[1]!);
    const confirm = await screen.findByRole('dialog');
    expect(confirm).toHaveTextContent('Delete this payment method?');
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith('id-cash'));
    await waitFor(() => expect(screen.queryByText('cash')).toBeNull());
    expect(screen.getByText('transfer')).toBeInTheDocument();
  });

  it('offers an operator who may only read neither New, nor Edit, nor Delete', async () => {
    await mount(['payment_methods:read']);
    await waitFor(() => expect(screen.getByText('transfer')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'New method' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for transfer' })).toBeNull();
  });

  it('carries the one create action in the empty state while there is no method', async () => {
    list.mockResolvedValue([]);
    await mount();

    await waitFor(() => expect(screen.getByText('No payment methods yet.')).toBeInTheDocument());
    // One "New method", in the empty state, not a second one in the header (Von Restorff).
    expect(screen.getAllByRole('button', { name: 'New method' })).toHaveLength(1);
  });

  it('says a failed load and offers a retry', async () => {
    const user = userEvent.setup();
    list.mockRejectedValueOnce(new Error('503'));
    await mount();

    const retry = await screen.findByRole('button', { name: 'Retry' });
    await user.click(retry);
    await waitFor(() => expect(screen.getByText('transfer')).toBeInTheDocument());
  });
});
