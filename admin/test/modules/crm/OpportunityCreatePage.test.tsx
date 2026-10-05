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
