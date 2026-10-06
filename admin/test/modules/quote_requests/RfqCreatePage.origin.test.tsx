import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * The create-quote-request screen opened from another screen (feature 143,
 * US10): the query string may name where the request is being created from,
 * what to preselect, and where to go back to. Without any of it the screen
 * and its request are what they were.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const navigateSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => getSpy(...a),
      post: (...a: unknown[]) => postSpy(...a),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const { RfqCreatePage } = await import(
  '../../../../packages/modules/quote_requests/src/admin/pages/RfqCreatePage'
);

const ORIGIN_ID = '00000000-0000-4000-8000-0000000000b1';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
const RETURN_TO = `/crm/opportunities/${ORIGIN_ID}?created=quote_request`;
const CUSTOMER = {
  id: 'cust-1',
  email: 'jan@acme.test',
  firstName: 'Jan',
  lastName: 'Kowalski',
  organizationId: ORGANIZATION_ID,
  organizationName: 'Acme',
};
const PRODUCT = { id: 'prod-1', sku: 'SKU-1', slug: 'p1', status: 'active', name: { 'en-US': 'Widget' } };

const BUNDLE = passthroughBundle('core', ['rfqCreate.submit', 'rfqCreate.back', 'common.action.back']);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith('/api/v1/admin/catalog/products')) return Promise.resolve({ data: [PRODUCT] });
    if (path.includes('/resolved-price')) {
      return Promise.resolve({ data: { resolvedPrice: { amount: '10.00' } } });
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockResolvedValue({ data: { id: 'new-rfq-1' } });
});

async function pick(comboLabel: string, optionLabel: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(comboLabel));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(optionLabel) }));
}

function renderPage(params: Record<string, string> = {}): void {
  const query = new URLSearchParams(params).toString();
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/quote-requests/new${query ? `?${query}` : ''}`]}>
        <RfqCreatePage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['quote_requests'] }),
      },
    ),
    BUNDLE,
  );
}

/** One priced line, then submit. */
async function addLineAndSubmit(): Promise<void> {
  await userEvent.type(screen.getByLabelText('product-0'), 'Wid');
  await pick('product-0', 'Widget');
  await waitFor(() => expect(screen.getByLabelText('price-0')).toHaveValue(10));
  const submit = screen.getByText('rfqCreate.submit');
  await waitFor(() => expect(submit).not.toBeDisabled());
  await userEvent.click(submit);
}

describe('RfqCreatePage opened with an origin', () => {
  it('preselects the customer, sends the origin, and returns to where it came from', async () => {
    renderPage({
      originType: 'crm_opportunity',
      originId: ORIGIN_ID,
      organizationId: ORGANIZATION_ID,
      customerAccountId: 'cust-1',
      returnTo: RETURN_TO,
    });
    // The picker is not touched: the customer arrives chosen, by name.
    await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue('Jan Kowalski'));
    await addLineAndSubmit();

    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/quote-requests', {
      organizationId: ORGANIZATION_ID,
      customerAccountId: 'cust-1',
      items: [{ productId: 'prod-1', quantity: 1, agreedUnitPrice: 10 }],
      origin: { type: 'crm_opportunity', id: ORIGIN_ID },
    });
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(RETURN_TO, {
        state: { createdDocument: { id: 'new-rfq-1' } },
      }),
    );
  });

  it('offers only the customers of the organization it was given, before anything is typed', async () => {
    renderPage({ originType: 'crm_opportunity', originId: ORIGIN_ID, organizationId: ORGANIZATION_ID });
    const searches = (): string[] =>
      getSpy.mock.calls
        .map(([path]) => String(path))
        .filter((path) => path.startsWith('/api/v1/admin/customers?'));
    await waitFor(() => expect(searches().length).toBeGreaterThan(0));
    await userEvent.type(screen.getByLabelText('customerAccountId'), 'Jan');
    await waitFor(() => expect(searches().some((path) => path.includes('q=Jan'))).toBe(true));
    for (const path of searches()) {
      expect(new URLSearchParams(path.split('?')[1]).get('organizationId')).toBe(ORGANIZATION_ID);
    }
  });

  it('leads back to where it came from', async () => {
    renderPage({ returnTo: RETURN_TO });
    // Not "Back to quote requests": it does not lead there.
    expect(screen.getByRole('link', { name: /common.action.back/ })).toHaveAttribute('href', RETURN_TO);
    expect(screen.queryByRole('link', { name: /rfqCreate.back/ })).toBeNull();
  });

  it.each(['https://evil.example/x', '//evil.example/x'])(
    'does not follow a return address that leaves the application: %s',
    async (returnTo) => {
      renderPage({ returnTo });
      expect(screen.getByRole('link', { name: /rfqCreate.back/ })).toHaveAttribute('href', '/quote-requests');
    },
  );

  it('sends no origin for one that is not well-formed', async () => {
    renderPage({ originType: 'crm_opportunity', originId: 'nope', customerAccountId: 'cust-1' });
    await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue('Jan Kowalski'));
    await addLineAndSubmit();
    const [, body] = postSpy.mock.calls[0] ?? [];
    expect(body).not.toHaveProperty('origin');
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/quote-requests/new-rfq-1'));
  });
});

describe('RfqCreatePage opened on its own', () => {
  it('sends the request it always sent, and goes to the new quote request', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText('customerAccountId'), 'Jan');
    await pick('customerAccountId', 'Jan Kowalski');
    await addLineAndSubmit();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/quote-requests', {
      organizationId: ORGANIZATION_ID,
      customerAccountId: 'cust-1',
      items: [{ productId: 'prod-1', quantity: 1, agreedUnitPrice: 10 }],
    });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/quote-requests/new-rfq-1'));
    // No narrowing of the search, and no read of a customer nobody named.
    const customerReads = getSpy.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith('/api/v1/admin/customers'));
    expect(customerReads.every((path) => !path.includes('organizationId'))).toBe(true);
    expect(customerReads.every((path) => path.startsWith('/api/v1/admin/customers?'))).toBe(true);
  });
});
