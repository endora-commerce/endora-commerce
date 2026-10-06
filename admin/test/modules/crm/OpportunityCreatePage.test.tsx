import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CHANNEL_ID,
  CONTACT_ID,
  OPPORTUNITY_ID,
  ORGANIZATION_ID,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
} from './crm-fixtures';

/**
 * Creating an Opportunity by hand (`specs/143-crm-sales-opportunities/`, User
 * Story 1 — tasks T037 and T053; FR-001, FR-002).
 *
 * Title, Organization and currency are required; the contact person and the
 * Sales Channel are optional and sent when chosen; success lands on the new
 * Opportunity. An `organizationId` query parameter preselects the Organization
 * — the entry point a later story's "New opportunity" link on an Organization
 * uses.
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
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OpportunityCreatePage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityCreatePage'
);

const CUSTOMER_ID = CONTACT_ID;

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  postSpy.mockResolvedValue({ data: detail() });
});

function renderPage(path = '/crm/opportunities/new'): void {
  renderCrm(<OpportunityCreatePage />, { path, pattern: '/crm/opportunities/new' });
}

/** Open a combobox by its accessible name and click the option matching `label`. */
async function pick(comboLabel: string, optionLabel: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(comboLabel));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(optionLabel) }));
}

async function chooseCurrency(code: string): Promise<void> {
  const select = screen.getByLabelText(en('opportunity.field.currency'), { exact: false });
  await waitFor(() => expect(select.querySelector(`option[value="${code}"]`)).not.toBeNull());
  await userEvent.selectOptions(select, code);
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: en('opportunity.create.submit') });
}

describe('OpportunityCreatePage', () => {
  it('requires a title, an organization and a currency', async () => {
    renderPage();
    await userEvent.click(submitButton());

    expect(await screen.findByText(en('opportunity.create.error.title'))).toBeInTheDocument();
    expect(screen.getByText(en('opportunity.create.error.organization'))).toBeInTheDocument();
    expect(screen.getByText(en('opportunity.create.error.currency'))).toBeInTheDocument();
    expect(screen.getByLabelText(en('opportunity.field.title'), { exact: false })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('creates an opportunity from the three required fields and opens it', async () => {
    renderPage();
    await userEvent.type(
      screen.getByLabelText(en('opportunity.field.title'), { exact: false }),
      'Fleet renewal',
    );
    await pick(en('opportunity.field.organization'), 'Acme');
    await chooseCurrency('PLN');
    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/crm/opportunities', {
        title: 'Fleet renewal',
        organizationId: ORGANIZATION_ID,
        currency: 'PLN',
      }),
    );
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(`/crm/opportunities/${OPPORTUNITY_ID}`),
    );
  });

  it('sends the contact person, the sales channel, the value and the description when given', async () => {
    renderPage();
    await userEvent.type(
      screen.getByLabelText(en('opportunity.field.title'), { exact: false }),
      'Fleet renewal',
    );
    await pick(en('opportunity.field.organization'), 'Acme');
    // The contact search is scoped to the chosen Organization.
    await pick(en('opportunity.field.contact'), 'Jan Kowalski');
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/crm/lookups/contacts?organizationId=${ORGANIZATION_ID}`,
    );
    await pick(en('opportunity.field.salesChannel'), 'Wholesale');
    await chooseCurrency('EUR');
    // A comma is what a Polish keyboard produces; it is accepted, not refused.
    await userEvent.type(screen.getByLabelText(en('opportunity.field.value')), '12 500,5');
    await userEvent.type(screen.getByLabelText(en('opportunity.field.description')), 'Forty vans.');
    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/crm/opportunities', {
        title: 'Fleet renewal',
        organizationId: ORGANIZATION_ID,
        currency: 'EUR',
        customerAccountId: CUSTOMER_ID,
        salesChannelId: CHANNEL_ID,
        manualValue: '12500.50',
        description: 'Forty vans.',
      }),
    );
    // `tagIds` answers 422 until its story lands; it is never part of the body.
    expect(postSpy.mock.calls[0]?.[1]).not.toHaveProperty('tagIds');
  });

  it('offers the contact person only once an organization is chosen, and forgets it when that changes', async () => {
    renderPage();
    expect(screen.getByLabelText(en('opportunity.field.contact'))).toBeDisabled();
    await pick(en('opportunity.field.organization'), 'Acme');
    expect(screen.getByLabelText(en('opportunity.field.contact'))).not.toBeDisabled();
    await pick(en('opportunity.field.contact'), 'Jan Kowalski');
    expect(screen.getByLabelText(en('opportunity.field.contact'))).toHaveValue('Jan Kowalski');
    // A contact person belongs to one Organization: clearing it clears them.
    await userEvent.click(
      screen.getAllByRole('button', { name: core('common.combobox.clearSelection') })[0] as HTMLElement,
    );
    expect(screen.getByLabelText(en('opportunity.field.contact'))).toBeDisabled();
    expect(screen.getByLabelText(en('opportunity.field.contact'))).toHaveValue('');
  });

  it('refuses a value that is not a number, without calling the server', async () => {
    renderPage();
    await userEvent.type(
      screen.getByLabelText(en('opportunity.field.title'), { exact: false }),
      'Fleet renewal',
    );
    await pick(en('opportunity.field.organization'), 'Acme');
    await chooseCurrency('PLN');
    await userEvent.type(screen.getByLabelText(en('opportunity.field.value')), 'a lot');
    await userEvent.click(submitButton());

    expect(await screen.findByText(en('opportunity.create.error.value'))).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('preselects the organization named in the query string', async () => {
    renderPage(`/crm/opportunities/new?organizationId=${ORGANIZATION_ID}`);
    await waitFor(() =>
      expect(screen.getByLabelText(en('opportunity.field.organization'))).toHaveValue('Acme'),
    );
    await userEvent.type(
      screen.getByLabelText(en('opportunity.field.title'), { exact: false }),
      'Fleet renewal',
    );
    await chooseCurrency('PLN');
    await userEvent.click(submitButton());

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/admin/crm/opportunities',
        expect.objectContaining({ organizationId: ORGANIZATION_ID }),
      ),
    );
  });

  it('keeps what was typed and shows the server\'s sentence when the create is refused', async () => {
    postSpy.mockRejectedValue(
      new ApiError(422, {
        error: { code: 'VALIDATION_FAILED', message: 'The organization is not available to you.' },
      }),
    );
    renderPage();
    const title = screen.getByLabelText(en('opportunity.field.title'), { exact: false });
    await userEvent.type(title, 'Fleet renewal');
    await pick(en('opportunity.field.organization'), 'Acme');
    await chooseCurrency('PLN');
    await userEvent.click(submitButton());

    expect(await screen.findByText('The organization is not available to you.')).toBeInTheDocument();
    expect(title).toHaveValue('Fleet renewal');
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('OpportunityCreatePage — created from an order (User Story 17)', () => {
  const ORDER = '00000000-0000-4000-8000-0000000000c1';
  const FROM_ORDER = `/crm/opportunities/new?organizationId=${ORGANIZATION_ID}&linkDocumentKind=order&linkDocumentId=${ORDER}`;
  const LINK_URL = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}/links`;

  async function fillAndSubmit(): Promise<void> {
    await userEvent.type(screen.getByLabelText(en('opportunity.field.title'), { exact: false }), 'Fleet');
    await chooseCurrency('PLN');
    await userEvent.click(submitButton());
  }

  it('says the new opportunity will be linked to the order', () => {
    renderPage(FROM_ORDER);
    expect(screen.getByText(en('orderPanel.createForm.hint'))).toBeTruthy();
  });

  it('links the order once the opportunity exists, then opens the opportunity', async () => {
    postSpy.mockImplementation((path: string) =>
      Promise.resolve({ data: path === LINK_URL ? { id: 'link-1' } : detail() }),
    );
    renderPage(FROM_ORDER);
    await fillAndSubmit();

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith(`/crm/opportunities/${OPPORTUNITY_ID}`));
    expect(postSpy.mock.calls.map(([path]) => path)).toEqual(['/api/v1/admin/crm/opportunities', LINK_URL]);
    expect(postSpy.mock.calls[1]?.[1]).toEqual({ documentKind: 'order', documentId: ORDER });
    // The create request itself is unchanged: the link is a second call.
    expect(postSpy.mock.calls[0]?.[1]).not.toHaveProperty('linkDocumentId');
  });

  it('shows a refused link, keeps the opportunity reachable and does not create a second one', async () => {
    postSpy.mockImplementation((path: string) =>
      path === LINK_URL
        ? Promise.reject(
            new ApiError(409, {
              error: { code: 'CRM_DOCUMENT_ALREADY_LINKED', message: 'This order is already linked.', requestId: 'r' },
            } as never),
          )
        : Promise.resolve({ data: detail() }),
    );
    renderPage(FROM_ORDER);
    await fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      en('orderPanel.createForm.linkFailed', { number: detail().number, reason: 'This order is already linked.' }),
    );
    expect(screen.getByRole('link', { name: en('orderPanel.createForm.open') })).toHaveAttribute(
      'href',
      `/crm/opportunities/${OPPORTUNITY_ID}`,
    );
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(submitButton()).toBeDisabled();
  });

  it('links a quote request the same way, and says so in its own words', async () => {
    const QUOTE = '00000000-0000-4000-8000-0000000000a7';
    postSpy.mockImplementation((path: string) =>
      Promise.resolve({ data: path === LINK_URL ? { id: 'link-1' } : detail() }),
    );
    renderPage(
      `/crm/opportunities/new?organizationId=${ORGANIZATION_ID}&linkDocumentKind=quote_request&linkDocumentId=${QUOTE}`,
    );
    expect(screen.getByText(en('orderPanel.createForm.hintQuoteRequest'))).toBeTruthy();
    expect(screen.queryByText(en('orderPanel.createForm.hint'))).toBeNull();
    await fillAndSubmit();

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith(`/crm/opportunities/${OPPORTUNITY_ID}`));
    expect(postSpy.mock.calls[1]).toEqual([LINK_URL, { documentKind: 'quote_request', documentId: QUOTE }]);
  });

  it('names the quote request when its link is refused', async () => {
    const QUOTE = '00000000-0000-4000-8000-0000000000a7';
    postSpy.mockImplementation((path: string) =>
      path === LINK_URL
        ? Promise.reject(
            new ApiError(409, {
              error: { code: 'CRM_DOCUMENT_ALREADY_LINKED', message: 'Already linked.', requestId: 'r' },
            } as never),
          )
        : Promise.resolve({ data: detail() }),
    );
    renderPage(
      `/crm/opportunities/new?organizationId=${ORGANIZATION_ID}&linkDocumentKind=quote_request&linkDocumentId=${QUOTE}`,
    );
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      en('orderPanel.createForm.linkFailedQuoteRequest', { number: detail().number, reason: 'Already linked.' }),
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('makes no link call without the two parameters, or with a kind it does not know', async () => {
    postSpy.mockResolvedValue({ data: detail() });
    renderPage(`/crm/opportunities/new?organizationId=${ORGANIZATION_ID}&linkDocumentKind=invoice&linkDocumentId=${ORDER}`);
    expect(screen.queryByText(en('orderPanel.createForm.hint'))).toBeNull();
    await fillAndSubmit();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});
