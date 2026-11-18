import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #1447 (UX audit DS-14) — the customer screen's first load is a skeleton
 * rather than a grey sentence, a first load that fails offers a retry, and the
 * re-read after an account action keeps the customer on screen, marked
 * `aria-busy`.
 */

installOffsetParentShim();

const getSpy = vi.fn();
const postSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

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
const { CustomerDetail } = await import('../../../../packages/modules/customers/src/admin/pages/CustomerDetail');

function read(path: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
}
function bundle(language: 'en' | 'pl'): Record<string, Record<string, string>> {
  return {
    core: read(`../packages/modules/_i18n/i18n/${language}.json`),
    customers: read(`../packages/modules/customers/i18n/${language}.json`),
  };
}
const EN = read('../packages/modules/customers/i18n/en.json');
const T = (key: string): string => EN[key] as string;

const CUSTOMER_ID = '00000000-0000-4000-8000-000000001471';
const CUSTOMER = {
  id: CUSTOMER_ID,
  email: 'ewa@buyer.test',
  firstName: 'Ewa',
  lastName: 'Nowak',
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

const CORE_EN = read('../packages/modules/_i18n/i18n/en.json');

function renderDetail(readCustomer: () => Promise<unknown>): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/customers/${CUSTOMER_ID}`) return readCustomer();
    if (path === '/api/v1/admin/custom-fields/definitions?entityType=customer') return Promise.resolve({ data: [] });
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
        session: adminSession({ permissions: ['customers:read', 'customers:manage', 'mfa:reset'] }),
        presence: modulePresence({ present: ['customers'] }),
        contributions: [],
      },
    ),
    bundle('en'),
  );
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  deleteSpy.mockReset();
});

describe('CustomerDetail — first load and refresh (DS-14)', () => {
  it('shows a busy skeleton region on the first load', async () => {
    let release!: () => void;
    renderDetail(() => new Promise((resolve) => (release = () => resolve({ data: CUSTOMER }))));

    const region = await screen.findByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent(T('detail.loading'));

    release();
    expect(await screen.findByText(T('detail.info.title'))).toBeInTheDocument();
  });

  it('keeps the customer on screen and busy while it re-reads after Block', async () => {
    const reads: Array<(value: unknown) => void> = [];
    renderDetail(() => new Promise((resolve) => reads.push(resolve)));
    await waitFor(() => expect(reads).toHaveLength(1));
    reads[0]!({ data: CUSTOMER });
    const heading = await screen.findByText(T('detail.info.title'));
    postSpy.mockResolvedValue({});

    await userEvent.click(screen.getByRole('button', { name: T('detail.action.block') }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block customer' }));

    await waitFor(() => expect(reads).toHaveLength(2));
    expect(heading).toBeInTheDocument();
    expect(heading.closest('[aria-busy="true"]')).not.toBeNull();

    reads[1]!({ data: { ...CUSTOMER, blocked: true } });
    await waitFor(() => expect(heading.closest('[aria-busy="true"]')).toBeNull());
    expect(heading).toBeInTheDocument();
  });

  it('a first load that fails shows the error and a retry', async () => {
    let attempt = 0;
    renderDetail(() => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ data: CUSTOMER });
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(T('detail.error'));

    await userEvent.click(within(alert).getByRole('button', { name: CORE_EN['common.action.retry']! }));
    expect(await screen.findByText(T('detail.info.title'))).toBeInTheDocument();
  });
});
