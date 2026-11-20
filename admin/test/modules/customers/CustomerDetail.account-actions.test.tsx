import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #1471 (UX audit SALES-05) — *Delete*, *Block* and *Reset two-step
 * verification* on the customer detail fired on one click, in one row with the
 * everyday actions. Each now asks in the kit's `ConfirmDialog`, naming the
 * customer and the consequence, with focus on Cancel; the request runs inside
 * the dialog, so a refusal stays there. Since #1517 every one of them is an
 * entry of the header's "More" menu, *Delete* last and set apart.
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
  OrganizationAssignmentField: () => null,
  CustomerGroupField: () => null,
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
const CORE_EN = read('../packages/modules/_i18n/i18n/en.json');

/** Issue #1517 — the account actions are entries of the header's "More" menu. */
async function chooseAction(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: CORE_EN['common.action.more'] as string }));
  const menu = await screen.findByRole('menu');
  await userEvent.click(within(menu).getByRole('menuitem', { name }));
}

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

function renderDetail(language: 'en' | 'pl' = 'en'): void {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/customers/${CUSTOMER_ID}`) return Promise.resolve({ data: CUSTOMER });
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
    bundle(language),
    { language },
  );
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  deleteSpy.mockReset();
});

describe('CustomerDetail — account actions ask first (#1471)', () => {
  it('Block: names the customer and the sign-out, opens on Cancel, and Cancel blocks nothing', async () => {
    renderDetail();
    await chooseAction(T('detail.action.block'));

    const dialog = await screen.findByRole('dialog', { name: 'Block Ewa Nowak?' });
    expect(dialog).toHaveTextContent('signed out');
    expect(within(dialog).getAllByRole('button')[0]).toHaveFocus();
    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('Block: posts on confirm, closes, and re-reads the customer', async () => {
    postSpy.mockResolvedValue({});
    renderDetail();
    await chooseAction(T('detail.action.block'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block customer' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/customers/${CUSTOMER_ID}/block`, {}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(getSpy.mock.calls.filter(([p]) => p === `/api/v1/admin/customers/${CUSTOMER_ID}`).length).toBeGreaterThanOrEqual(2);
  });

  it('Reset two-step verification asks before removing the enrolment', async () => {
    postSpy.mockResolvedValue({ data: { affected: true } });
    renderDetail();
    await chooseAction(T('detail.action.resetMfa'));
    const dialog = await screen.findByRole('dialog', { name: 'Reset two-step verification for Ewa Nowak?' });
    expect(postSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset two-step verification' }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/customers/${CUSTOMER_ID}/mfa/reset`, {}));
  });

  it('Delete is the last entry of "More", set apart from the everyday actions (#1517)', async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: CORE_EN['common.action.more'] as string }));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    const del = items[items.length - 1]!;
    expect(del).toHaveTextContent(T('detail.action.delete'));
    expect(del.previousElementSibling).toBe(within(menu).getByRole('separator'));
  });

  it('Delete: a refusal stays in the dialog, and nothing else changes', async () => {
    deleteSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'ORG_OWNER_DEPLETION', message: 'This customer is the last administrator.' } } as never),
    );
    renderDetail();
    await chooseAction(T('detail.action.delete'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Ewa Nowak?' });
    expect(dialog).toHaveTextContent('can be restored');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete customer' });
    await userEvent.click(confirmButton);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This customer is the last administrator.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(confirmButton).toBeEnabled();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('blocks a second click while the request is in flight', async () => {
    deleteSpy.mockImplementation(() => new Promise(() => undefined));
    renderDetail();
    await chooseAction(T('detail.action.delete'));
    const dialog = await screen.findByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete customer' });
    await userEvent.click(confirmButton);
    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(confirmButton).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(confirmButton);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('asks in Polish too', async () => {
    renderDetail('pl');
    const pl = read('../packages/modules/customers/i18n/pl.json');
    const corePl = read('../packages/modules/_i18n/i18n/pl.json');
    await userEvent.click(await screen.findByRole('button', { name: corePl['common.action.more'] as string }));
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: pl['detail.action.block'] as string }));
    const dialog = await screen.findByRole('dialog', { name: 'Zablokować konto klienta?' });
    expect(within(dialog).getByRole('button', { name: 'Zablokuj klienta' })).toBeInTheDocument();
  });
});
