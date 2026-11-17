import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1328 — *Impersonate* on the admin customer detail posted an empty body
 * and showed nothing: no reason was asked for, nothing said a session had
 * started or how to use and end it, and every further click started another
 * session. It asks for an optional reason now, sends it with the start, says
 * what happened — the storefront link and how to end the session on success,
 * the refusal inside the dialog on failure — and does not offer a second start
 * while the session it started is open.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

// The sibling panels pull their own data; none is under test here.
vi.mock('../../../../packages/modules/customers/src/admin/panels/HistoryPanels', () => ({
  OrdersPanel: () => null,
  QuoteRequestsPanel: () => null,
  CartsPanel: () => null,
}));
vi.mock('../../../../packages/modules/customers/src/admin/panels/ManagementPanels', () => ({
  OrganizationAssignmentPanel: () => null,
  CustomerGroupPanel: () => null,
  AddressesPanel: () => null,
}));
const { CustomerDetail } = await import(
  '../../../../packages/modules/customers/src/admin/pages/CustomerDetail',
);

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const CUSTOMERS_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/customers/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN, customers: CUSTOMERS_EN };
const T = (key: string): string => CUSTOMERS_EN[key] as string;

const CUSTOMER_ID = '00000000-0000-4000-8000-000000001328';

const CUSTOMER = {
  id: CUSTOMER_ID,
  email: 'buyer1328@test.com',
  firstName: 'Ewa',
  lastName: 'Support',
  organizationId: null,
  organizationName: null,
  customerGroupId: null,
  customerGroupName: null,
  blocked: false,
  deleted: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  preferredLanguage: null,
  block: null,
  deletion: null,
  customFieldValues: {},
};

const START_PATH = `/api/v1/admin/customers/${CUSTOMER_ID}/impersonate`;
const END_PATH = '/api/v1/admin/impersonation/end';

const STARTED = {
  data: {
    impersonationSessionId: '00000000-0000-4000-8000-00000000a001',
    impersonatedCustomerAccount: {
      id: CUSTOMER_ID,
      email: CUSTOMER.email,
      firstName: CUSTOMER.firstName,
      lastName: CUSTOMER.lastName,
      organizationRole: { id: 'r1', key: 'buyer', name: 'Buyer' },
    },
  },
};

function renderDetail(): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/customers/${CUSTOMER_ID}`) return Promise.resolve({ data: CUSTOMER });
    if (path === '/api/v1/admin/custom-fields/definitions?entityType=customer') {
      return Promise.resolve({ data: [] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/customers/${CUSTOMER_ID}`]}>
        <Routes>
          <Route path="/customers/:id" element={<CustomerDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['customers:read', 'customers:impersonate'] }),
        presence: modulePresence({ present: ['customers'] }),
        contributions: [],
      },
    ),
    bundle,
  );
}

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: T('detail.action.impersonate') }));
  return screen.findByRole('dialog');
}

function startCalls(): unknown[][] {
  return postSpy.mock.calls.filter(([path]) => path === START_PATH);
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('CustomerDetail — impersonation (#1328)', () => {
  it('asks for an optional reason before anything starts, and Cancel starts nothing', async () => {
    renderDetail();
    const dialog = await openDialog();

    expect(within(dialog).getByLabelText(T('detail.impersonate.reasonLabel'))).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: CORE_EN['common.action.cancel'] as string }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('sends the reason with the start and says how to continue and how to end the session', async () => {
    postSpy.mockResolvedValue(STARTED);
    renderDetail();
    const dialog = await openDialog();

    await userEvent.type(within(dialog).getByLabelText(T('detail.impersonate.reasonLabel')), 'Ticket 42');
    await userEvent.click(within(dialog).getByRole('button', { name: T('detail.impersonate.confirm') }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(startCalls()).toEqual([[START_PATH, { reason: 'Ticket 42' }]]);

    const status = await screen.findByTestId('impersonation-status');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toContain(T('detail.impersonate.startedHelp'));
    const link = within(status).getByRole('link', { name: new RegExp(T('detail.impersonate.openStorefront')) });
    expect(link.getAttribute('href')).toMatch(/\/account$/);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // The button that opened the dialog is disabled now, so focus lands on the next step.
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it('sends no reason when the operator gave none', async () => {
    postSpy.mockResolvedValue(STARTED);
    renderDetail();
    const dialog = await openDialog();

    await userEvent.type(within(dialog).getByLabelText(T('detail.impersonate.reasonLabel')), '   ');
    await userEvent.click(within(dialog).getByRole('button', { name: T('detail.impersonate.confirm') }));

    await screen.findByTestId('impersonation-status');
    expect(startCalls()).toEqual([[START_PATH, {}]]);
  });

  it('does not offer a second start while the session it started is open', async () => {
    postSpy.mockResolvedValue(STARTED);
    renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: T('detail.impersonate.confirm') }));
    await screen.findByTestId('impersonation-status');

    const again = screen.getByRole('button', { name: T('detail.action.impersonate') }) as HTMLButtonElement;
    expect(again.disabled).toBe(true);
    await userEvent.click(again);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(startCalls()).toHaveLength(1);
  });

  it('keeps the dialog open with the refusal when the start is refused', async () => {
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    postSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'CUSTOMER_ALREADY_DELETED', message: 'Customer is deleted.' } }),
    );
    renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: T('detail.impersonate.confirm') }));

    expect(await within(dialog).findByText('Customer is deleted.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(screen.getByTestId('impersonation-status').textContent).toBe('');
  });

  it('ends the session from the screen and offers a new start afterwards', async () => {
    postSpy.mockImplementation((path: string) =>
      Promise.resolve(path === END_PATH ? { data: { restored: true } } : STARTED),
    );
    renderDetail();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: T('detail.impersonate.confirm') }));
    const status = await screen.findByTestId('impersonation-status');

    await userEvent.click(within(status).getByRole('button', { name: T('detail.impersonate.end') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(END_PATH, {}));
    expect((await screen.findByTestId('impersonation-status')).textContent).toContain(T('detail.impersonate.ended'));
    const again = screen.getByRole('button', { name: T('detail.action.impersonate') }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(again));
  });
});
