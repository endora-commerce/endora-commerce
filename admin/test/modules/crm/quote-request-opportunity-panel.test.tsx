import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { ADMIN_ID, CRM_BUNDLE_EN, OPPORTUNITY_ID, ORGANIZATION_ID, en, summary } from './crm-fixtures';

/**
 * CRM's panel on the Quote Request screen (`specs/143-crm-sales-opportunities/`,
 * User Story 17 — the Quote Request half; `contracts/admin-surfaces.md` §5).
 *
 * `quote_requests` mounts `quote_request.detail.after` and names nobody. CRM
 * contributes the panel the Order screen has, for the other document kind: the
 * Opportunity the request is linked to, or the two ways to give it one. Its
 * sentences say "quote request", the link and the create form carry that kind,
 * and the request's Organization is read from the quote desk's own endpoint.
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

const crm = await import('@endora-commerce/mod-crm/admin');
const REGISTRY = [{ moduleId: 'crm', contributions: crm.contributions }];

const QUOTE_ID = '00000000-0000-4000-8000-0000000000a7';
const DOCUMENT_URL = `/api/v1/admin/crm/documents/quote_request/${QUOTE_ID}/opportunity`;
const QUOTE_URL = `/api/v1/admin/quote-requests/${QUOTE_ID}`;
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
        <MemoryRouter initialEntries={[`/quote-requests/${QUOTE_ID}`]}>
          <AdminZone name="quote_request.detail.after" props={{ quoteRequestId: QUOTE_ID }} />
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({
          permissions: [...(options.permissions ?? ['crm:read', 'crm:write', 'rfqs:handle'])],
        }),
        presence: modulePresence({ present: [...(options.present ?? ['crm', 'quote_requests'])] }),
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
    if (path === QUOTE_URL) return Promise.resolve({ data: { id: QUOTE_ID, organizationId: ORGANIZATION_ID } });
    if (path === OPEN_URL) {
      return Promise.resolve({
        data: [summary(), summary({ id: SECOND_ID, number: 'OPP-000002', title: 'Spare parts' })],
        pagination: { cursor: null, hasMore: false, limit: 100 },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('crm contributes the quote request detail zone', () => {
  it('declares the contribution on crm:read, behind a dynamic import', () => {
    const zone = (crm.contributions.zones ?? []).find((entry) => entry.zone === 'quote_request.detail.after');
    expect(zone?.requiredPermission).toBe('crm:read');
    expect(zone?.weight).toBe(600);
    expect(typeof zone?.component).toBe('function');
  });

  it('shows the linked opportunity and reads nothing of the quote request itself', async () => {
    linked = LINKED;
    renderZone();
    const heading = await screen.findByRole('heading', { name: en('orderPanel.title') });
    const panel = heading.closest('section') as HTMLElement;
    const link = await within(panel).findByRole('link', { name: /OPP-000042/ });
    expect(link).toHaveAttribute('href', `/crm/opportunities/${OPPORTUNITY_ID}`);
    expect(within(panel).getByText('Proposal')).toBeTruthy();
    expect(getSpy.mock.calls.map(([path]) => path)).toEqual([DOCUMENT_URL]);
  });

  it('says a quote request — not an order — is linked to none, and carries that kind to the create form', async () => {
    renderZone();
    expect(await screen.findByText(en('orderPanel.noneQuoteRequest'))).toBeTruthy();
    expect(screen.queryByText(en('orderPanel.none'))).toBeNull();
    const create = await screen.findByRole('link', { name: en('orderPanel.create') });
    expect(create).toHaveAttribute(
      'href',
      `/crm/opportunities/new?organizationId=${ORGANIZATION_ID}&linkDocumentKind=quote_request&linkDocumentId=${QUOTE_ID}`,
    );
    // The Organization comes from the quote desk's own endpoint, not from `orders`'.
    expect(getSpy.mock.calls.map(([path]) => path)).toContain(QUOTE_URL);
  });

  it('links the quote request to an open opportunity of its organization, then shows it', async () => {
    postSpy.mockImplementation(() => {
      linked = summary({ id: SECOND_ID, number: 'OPP-000002', title: 'Spare parts' });
      return Promise.resolve({ data: { id: 'link-1' } });
    });
    renderZone();
    await userEvent.click(await screen.findByRole('button', { name: en('orderPanel.link') }));
    const picker = await screen.findByLabelText(en('orderPanel.pick.label'));
    await waitFor(() => expect(picker.querySelector(`option[value="${SECOND_ID}"]`)).not.toBeNull());
    await userEvent.selectOptions(picker, SECOND_ID);
    await userEvent.click(screen.getByRole('button', { name: en('orderPanel.pick.confirm') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]).toEqual([
      `/api/v1/admin/crm/opportunities/${SECOND_ID}/links`,
      { documentKind: 'quote_request', documentId: QUOTE_ID },
    ]);
    expect(await screen.findByRole('link', { name: /OPP-000002/ })).toBeTruthy();
  });

  it('says the quote request could not be linked when the refusal carries no sentence', async () => {
    postSpy.mockRejectedValue(new Error('network'));
    renderZone();
    await userEvent.click(await screen.findByRole('button', { name: en('orderPanel.link') }));
    const picker = await screen.findByLabelText(en('orderPanel.pick.label'));
    await waitFor(() => expect(picker.querySelector(`option[value="${SECOND_ID}"]`)).not.toBeNull());
    await userEvent.selectOptions(picker, SECOND_ID);
    await userEvent.click(screen.getByRole('button', { name: en('orderPanel.pick.confirm') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(en('orderPanel.pick.failedQuoteRequest'));
  });

  it('renders nothing and asks nothing without crm:read, or while crm is not in the enabled set', async () => {
    const refused = renderZone({ permissions: ['rfqs:handle'] });
    await waitFor(() => expect(refused.textContent).toBe(''));
    expect(refused.innerHTML).toBe('');
    const off = renderZone({ present: ['quote_requests'] });
    await waitFor(() => expect(off.textContent).toBe(''));
    expect(getSpy).not.toHaveBeenCalled();
  });
});
