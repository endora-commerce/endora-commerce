import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import {
  ADMIN_ID,
  CRM_BUNDLE_EN,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORGANIZATION_ID,
  en,
  summary,
} from './crm-fixtures';

/**
 * CRM's panel on the Order screen (`specs/143-crm-sales-opportunities/`, User
 * Story 17 — task T173; `contracts/admin-surfaces.md` §5).
 *
 * `orders` mounts `order.detail.after` and names nobody. CRM contributes one
 * panel: the Opportunity the Order is linked to — number, title, status,
 * assignee, value, a link — or, for an Order linked to none, the two ways to
 * give it one. The zone renderer applies both presence axes and `crm:read`
 * before the chunk is fetched; the two write actions are `crm:write`'s.
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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const crm = await import('@endora-commerce/mod-crm/admin');
const REGISTRY = [{ moduleId: 'crm', contributions: crm.contributions }];

const DOCUMENT_URL = `/api/v1/admin/crm/documents/order/${ORDER_ID}/opportunity`;
const ORDER_URL = `/api/v1/admin/orders/${ORDER_ID}`;
const OPEN_URL = `/api/v1/admin/crm/opportunities?state=open&organizationId=${ORGANIZATION_ID}&limit=100`;
const SECOND_ID = '00000000-0000-4000-8000-0000000000b2';

const LINKED = summary({
  number: 'OPP-000042',
  assignee: { id: ADMIN_ID, name: 'Anna Nowak', active: true },
  status: { code: 'proposal', name: 'Proposal', color: '#8b5cf6', kind: 'open' },
});

let linked: unknown = null;

function renderZone(
  options: { readonly permissions?: readonly string[]; readonly present?: readonly string[] } = {},
): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[`/orders/${ORDER_ID}`]}>
          <AdminZone name="order.detail.after" props={{ orderId: ORDER_ID }} />
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({
          permissions: [...(options.permissions ?? ['crm:read', 'crm:write', 'orders:read'])],
        }),
        presence: modulePresence({ present: [...(options.present ?? ['crm', 'orders'])] }),
        contributions: REGISTRY,
      },
    ),
    { crm: CRM_BUNDLE_EN },
  );
  return container;
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  linked = null;
  getSpy.mockImplementation((path: string) => {
    if (path === DOCUMENT_URL) return Promise.resolve({ data: linked });
    if (path === ORDER_URL) return Promise.resolve({ data: { id: ORDER_ID, organizationId: ORGANIZATION_ID } });
    if (path === OPEN_URL) {
      return Promise.resolve({
        data: [summary(), summary({ id: SECOND_ID, number: 'OPP-000002', title: 'Spare parts' })],
        pagination: { cursor: null, hasMore: false, limit: 100 },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('crm contributes the order detail zone', () => {
  it('declares the contribution on crm:read, behind a dynamic import', () => {
    const zone = (crm.contributions.zones ?? []).find((entry) => entry.zone === 'order.detail.after');
    expect(zone?.requiredPermission).toBe('crm:read');
    expect(zone?.weight).toBe(600);
    expect(zone?.match).toBeUndefined();
    expect(typeof zone?.component).toBe('function');
  });

  it('shows the linked opportunity: number, title, status, assignee, value, and a link to it', async () => {
    linked = LINKED;
    renderZone();
    const heading = await screen.findByRole('heading', { name: en('orderPanel.title') });
    const panel = heading.closest('section') as HTMLElement;
    const link = await within(panel).findByRole('link', { name: /OPP-000042/ });
    expect(link).toHaveAttribute('href', `/crm/opportunities/${OPPORTUNITY_ID}`);
    expect(within(panel).getByText('Fleet renewal')).toBeTruthy();
    expect(within(panel).getByText('Proposal')).toBeTruthy();
    expect(within(panel).getByText('Anna Nowak')).toBeTruthy();
    expect(within(panel).getByText(/12[,\s.]?500/)).toBeTruthy();
    // Linked: nothing to link or create, and the Order itself is not read.
    expect(within(panel).queryByRole('button', { name: en('orderPanel.link') })).toBeNull();
    expect(within(panel).queryByRole('link', { name: en('orderPanel.create') })).toBeNull();
    expect(getSpy.mock.calls.map(([path]) => path)).toEqual([DOCUMENT_URL]);
  });

  it('offers "Create opportunity" for an unlinked order, carrying the organization and the order', async () => {
    renderZone();
    expect(await screen.findByText(en('orderPanel.none'))).toBeTruthy();
    const create = await screen.findByRole('link', { name: en('orderPanel.create') });
    expect(create).toHaveAttribute(
      'href',
      `/crm/opportunities/new?organizationId=${ORGANIZATION_ID}&linkDocumentKind=order&linkDocumentId=${ORDER_ID}`,
    );
  });

  it('links an unlinked order to an open opportunity of its organization, then shows it', async () => {
    postSpy.mockImplementation(() => {
      linked = summary({ id: SECOND_ID, number: 'OPP-000002', title: 'Spare parts' });
      return Promise.resolve({ data: { id: 'link-1' } });
    });
    renderZone();
    await userEvent.click(await screen.findByRole('button', { name: en('orderPanel.link') }));

    const picker = await screen.findByLabelText(en('orderPanel.pick.label'));
    await waitFor(() => expect(picker.querySelector(`option[value="${SECOND_ID}"]`)).not.toBeNull());
    expect(getSpy.mock.calls.map(([path]) => path)).toContain(OPEN_URL);
    const confirm = screen.getByRole('button', { name: en('orderPanel.pick.confirm') });
    expect(confirm).toBeDisabled();
    await userEvent.selectOptions(picker, SECOND_ID);
    await userEvent.click(confirm);

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]).toEqual([
      `/api/v1/admin/crm/opportunities/${SECOND_ID}/links`,
      { documentKind: 'order', documentId: ORDER_ID },
    ]);
    const link = await screen.findByRole('link', { name: /OPP-000002/ });
    expect(link).toHaveAttribute('href', `/crm/opportunities/${SECOND_ID}`);
    expect(screen.queryByText(en('orderPanel.none'))).toBeNull();
  });

  it('shows the server’s sentence when the link is refused, and stays unlinked', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'CRM_DOCUMENT_ALREADY_LINKED', message: 'This order is already linked.', requestId: 'r' },
      } as never),
    );
    renderZone();
    await userEvent.click(await screen.findByRole('button', { name: en('orderPanel.link') }));
    const picker = await screen.findByLabelText(en('orderPanel.pick.label'));
    await waitFor(() => expect(picker.querySelector(`option[value="${SECOND_ID}"]`)).not.toBeNull());
    await userEvent.selectOptions(picker, SECOND_ID);
    await userEvent.click(screen.getByRole('button', { name: en('orderPanel.pick.confirm') }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This order is already linked.');
    expect(screen.getByText(en('orderPanel.none'))).toBeTruthy();
  });

  it('shows the state and neither action to somebody who may only read', async () => {
    renderZone({ permissions: ['crm:read', 'orders:read'] });
    expect(await screen.findByText(en('orderPanel.none'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: en('orderPanel.link') })).toBeNull();
    expect(screen.queryByRole('link', { name: en('orderPanel.create') })).toBeNull();
    expect(getSpy.mock.calls.map(([path]) => path)).toEqual([DOCUMENT_URL]);
  });

  it('renders nothing and asks nothing without crm:read', async () => {
    const container = renderZone({ permissions: ['orders:read'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.innerHTML).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders nothing and asks nothing while crm is not in the enabled set', async () => {
    const container = renderZone({ present: ['orders'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.innerHTML).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });
});
