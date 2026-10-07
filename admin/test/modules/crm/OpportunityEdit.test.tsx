import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  OPPORTUNITY_ID,
  ORDER_STATUS_GRAPH,
  ORGANIZATION_ID,
  core,
  detail,
  en,
  renderCrm,
  storedText,
} from './crm-fixtures';

/**
 * Editing and deleting an Opportunity, and the reason of a status change
 * (`specs/143-crm-sales-opportunities/`, User Story 1 — task T181; FR-005,
 * `contracts/admin-api.md` §1–§2).
 *
 * Three subjects. An edit sends the fields that changed and nothing else, under
 * the version they were read at. A stale version is **said**, with a way to
 * read the Opportunity again, and is never retried behind the operator's back.
 * Deleting is offered to a holder of `crm:configure` and asks first.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();
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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const CONTACT_ID = '00000000-0000-4000-8000-0000000000f1';
const OTHER_CONTACT_ID = '00000000-0000-4000-8000-0000000000f2';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const CHANNEL_ID = '00000000-0000-4000-8000-000000000a01';

let current = detail();

beforeEach(() => {
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy, navigateSpy]) spy.mockReset();
  current = detail();
  getSpy.mockImplementation((path: string) => {
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path === '/api/v1/admin/crm/lookups/sales-channels') {
      return Promise.resolve({
        data: [
          {
            id: CHANNEL_ID,
            code: 'b2b',
            name: { en: 'Wholesale' },
            active: true,
            systemDefault: true,
            defaultCurrency: 'PLN',
            currencies: ['PLN'],
          },
        ],
      });
    }
    if (path.startsWith('/api/v1/admin/crm/lookups/contacts')) {
      return Promise.resolve({
        data: [
          { id: CONTACT_ID, name: 'Jan Kowalski', email: 'jan@acme.test' },
          { id: OTHER_CONTACT_ID, name: 'Ewa Inna', email: 'ewa@acme.test' },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(permissions?: readonly string[]): Promise<void> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  await screen.findByRole('region', { name: en('links.title') });
}

async function openForm(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: en('opportunity.edit.open') }));
  return screen.findByRole('form', { name: en('opportunity.edit.title') });
}

function save(form: HTMLElement): Promise<void> {
  return userEvent.click(within(form).getByRole('button', { name: en('opportunity.edit.submit') }));
}

const IF_MATCH_1 = { headers: { 'If-Match': '"1"' } };

describe('OpportunityDetail — editing', () => {
  it('offers no edit control to an operator who may only read', async () => {
    await renderPage(['crm:read', 'orders:read']);
    expect(screen.queryByRole('button', { name: en('opportunity.edit.open') })).toBeNull();
  });

  it('opens on the current values and shows what cannot be changed as text', async () => {
    current = detail({
      customerAccount: { id: CONTACT_ID, name: 'Jan Kowalski', email: 'jan@acme.test' },
    });
    await renderPage();
    const form = await openForm();
    expect(within(form).getByLabelText(new RegExp(en('opportunity.field.title')))).toHaveValue(
      'Fleet renewal',
    );
    expect(storedText(within(form).getByLabelText(en('opportunity.field.description')))).toBe(
      'Forty vans over two years.',
    );
    expect(within(form).getByLabelText(en('opportunity.field.expectedCloseDate'))).toHaveValue(
      '2026-12-01',
    );
    expect(within(form).getByLabelText(en('opportunity.field.value'))).toHaveValue('12500.00');
    expect(within(form).getByLabelText(en('opportunity.edit.valueMode'))).toHaveValue('manual');
    // The contact picker searches the Opportunity's own Organization only.
    expect(getSpy).toHaveBeenCalledWith(
      `/api/v1/admin/crm/lookups/contacts?organizationId=${ORGANIZATION_ID}`,
    );
    // The person already chosen is named in the picker itself.
    expect(within(form).getByLabelText(en('opportunity.field.contact'))).toHaveValue('Jan Kowalski');
    // Organization and currency are immutable: named, with no control to change them.
    expect(
      within(form).getByText(en('opportunity.edit.fixed', { organization: 'Acme', currency: 'PLN' })),
    ).toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('sends only the fields that changed, under the version they were read at', async () => {
    const saved = detail({ title: 'Fleet renewal 2027', version: 2 });
    patchSpy.mockResolvedValue({ data: saved });
    await renderPage();
    const form = await openForm();
    const title = within(form).getByLabelText(new RegExp(en('opportunity.field.title')));
    await userEvent.clear(title);
    await userEvent.type(title, 'Fleet renewal 2027');
    await save(form);

    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(DETAIL_PATH, { title: 'Fleet renewal 2027' }, IF_MATCH_1),
    );
    // The answer is what the screen now shows, and the form is gone.
    expect(await screen.findByRole('heading', { level: 1, name: /Fleet renewal 2027/ })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: en('opportunity.edit.title') })).toBeNull();
  });

  it('sends every optional field it changed, and null for one it cleared', async () => {
    current = detail({
      customerAccount: { id: CONTACT_ID, name: 'Jan Kowalski', email: 'jan@acme.test' },
    });
    patchSpy.mockResolvedValue({ data: detail({ version: 2 }) });
    await renderPage();
    const form = await openForm();
    // The first clear button of the form is the contact picker's.
    await userEvent.click(
      within(form).getAllByRole('button', { name: core('common.combobox.clearSelection') })[0] as HTMLElement,
    );
    await userEvent.clear(within(form).getByLabelText(en('opportunity.field.description')));
    await userEvent.clear(within(form).getByLabelText(en('opportunity.field.expectedCloseDate')));
    const value = within(form).getByLabelText(en('opportunity.field.value'));
    await userEvent.clear(value);
    // What a Polish keyboard produces is an amount, not an error.
    await userEvent.type(value, '14 000,5');
    await save(form);

    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(
        DETAIL_PATH,
        { customerAccountId: null, description: null, expectedCloseDate: null, manualValue: '14000.50' },
        IF_MATCH_1,
      ),
    );
  });

  it('sends another contact person and a sales channel when they are chosen', async () => {
    patchSpy.mockResolvedValue({ data: detail({ version: 2 }) });
    await renderPage();
    const form = await openForm();
    await userEvent.click(within(form).getByLabelText(en('opportunity.field.contact')));
    await userEvent.click(await screen.findByRole('option', { name: /Ewa Inna/ }));
    await userEvent.click(within(form).getByRole('combobox', { name: en('opportunity.field.salesChannel') }));
    await userEvent.click(await screen.findByRole('option', { name: /Wholesale/ }));
    await save(form);

    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(
        DETAIL_PATH,
        { customerAccountId: OTHER_CONTACT_ID, salesChannelId: CHANNEL_ID },
        IF_MATCH_1,
      ),
    );
  });

  it('switches the value to the computed one, and then asks for no amount', async () => {
    patchSpy.mockResolvedValue({ data: detail({ version: 2, valueMode: 'computed', value: '0.00' }) });
    await renderPage();
    const form = await openForm();
    await userEvent.selectOptions(within(form).getByLabelText(en('opportunity.edit.valueMode')), 'computed');
    expect(within(form).queryByLabelText(en('opportunity.field.value'))).toBeNull();
    await save(form);
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(DETAIL_PATH, { valueMode: 'computed' }, IF_MATCH_1),
    );
  });

  it('refuses an empty title and a value that is not an amount, without a request', async () => {
    await renderPage();
    const form = await openForm();
    await userEvent.clear(within(form).getByLabelText(new RegExp(en('opportunity.field.title'))));
    const value = within(form).getByLabelText(en('opportunity.field.value'));
    await userEvent.clear(value);
    await userEvent.type(value, 'a lot');
    await save(form);
    expect(within(form).getByText(en('opportunity.create.error.title'))).toBeInTheDocument();
    expect(within(form).getByText(en('opportunity.create.error.value'))).toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('makes no request when nothing was changed', async () => {
    await renderPage();
    const form = await openForm();
    await save(form);
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: en('opportunity.edit.title') })).toBeNull(),
    );
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('discards the draft on Cancel', async () => {
    await renderPage();
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText(new RegExp(en('opportunity.field.title'))), ' X');
    await userEvent.click(within(form).getByRole('button', { name: core('common.action.cancel') }));
    expect(screen.queryByRole('form', { name: en('opportunity.edit.title') })).toBeNull();
    expect(patchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: /Fleet renewal/ })).toBeInTheDocument();
  });

  it('says so when somebody else saved first, and overwrites nothing until the operator reloads', async () => {
    patchSpy.mockRejectedValueOnce(
      new ApiError(409, {
        error: { code: 'VERSION_CONFLICT', message: 'The opportunity was updated concurrently.' },
      }),
    );
    await renderPage();
    const form = await openForm();
    const title = within(form).getByLabelText(new RegExp(en('opportunity.field.title')));
    await userEvent.clear(title);
    await userEvent.type(title, 'Mine');
    await save(form);

    const alert = await within(form).findByRole('alert');
    expect(within(alert).getByText(en('opportunity.edit.conflict'))).toBeInTheDocument();
    // Saving again with the stale version is not possible; nothing is retried.
    expect(within(form).getByRole('button', { name: en('opportunity.edit.submit') })).toBeDisabled();
    expect(patchSpy).toHaveBeenCalledTimes(1);

    // Reload: the latest Opportunity is read and the form starts from it.
    current = detail({ title: 'Theirs', version: 5 });
    patchSpy.mockResolvedValueOnce({ data: detail({ title: 'Theirs, then mine', version: 6 }) });
    await userEvent.click(within(alert).getByRole('button', { name: en('opportunity.edit.reload') }));
    await waitFor(() =>
      expect(within(form).getByLabelText(new RegExp(en('opportunity.field.title')))).toHaveValue('Theirs'),
    );
    expect(within(form).queryByRole('alert')).toBeNull();
    expect(patchSpy).toHaveBeenCalledTimes(1);

    await userEvent.type(
      within(form).getByLabelText(new RegExp(en('opportunity.field.title'))),
      ', then mine',
    );
    await save(form);
    await waitFor(() =>
      expect(patchSpy).toHaveBeenLastCalledWith(
        DETAIL_PATH,
        { title: 'Theirs, then mine' },
        { headers: { 'If-Match': '"5"' } },
      ),
    );
  });

  it('shows the server\'s own sentence for any other refusal and keeps the draft', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: { code: 'VALIDATION_FAILED', message: 'The sales channel does not exist.' },
      }),
    );
    await renderPage();
    const form = await openForm();
    const title = within(form).getByLabelText(new RegExp(en('opportunity.field.title')));
    await userEvent.type(title, ' B');
    await save(form);
    expect(await within(form).findByText('The sales channel does not exist.')).toBeInTheDocument();
    expect(title).toHaveValue('Fleet renewal B');
    expect(within(form).getByRole('button', { name: en('opportunity.edit.submit') })).toBeEnabled();
  });
});

describe('OpportunityDetail — deleting', () => {
  it('is offered to a holder of crm:configure only', async () => {
    await renderPage(['crm:read', 'crm:write', 'orders:read']);
    expect(screen.queryByRole('button', { name: en('opportunity.delete.open') })).toBeNull();
  });

  it('asks first, names what goes with it, and deletes on confirmation', async () => {
    deleteSpy.mockResolvedValue(undefined);
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.delete.open') }));
    const dialog = await screen.findByRole('dialog', { name: en('opportunity.delete.title') });
    expect(
      within(dialog).getByText(en('opportunity.delete.body', { number: 'OPP-000001', title: 'Fleet renewal' })),
    ).toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: en('opportunity.delete.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(DETAIL_PATH));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/crm/opportunities'));
  });

  it('deletes nothing when the dialog is cancelled', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.delete.open') }));
    const dialog = await screen.findByRole('dialog', { name: en('opportunity.delete.title') });
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.cancel') }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('shows why a delete was refused and stays on the opportunity', async () => {
    deleteSpy.mockRejectedValue(
      new ApiError(403, { error: { code: 'FORBIDDEN', message: 'You are not allowed to do this.' } }),
    );
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.delete.open') }));
    const dialog = await screen.findByRole('dialog', { name: en('opportunity.delete.title') });
    await userEvent.click(within(dialog).getByRole('button', { name: en('opportunity.delete.confirm') }));
    expect(await within(dialog).findByText('You are not allowed to do this.')).toBeInTheDocument();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('OpportunityDetail — the reason of a status change', () => {
  const moved = {
    data: {
      opportunity: detail({
        status: { code: 'lost', name: 'Lost', color: '#ef4444', kind: 'lost' },
        allowedTransitions: [],
      }),
      from: 'new',
      to: 'lost',
      propagation: [],
    },
  };

  it('sends the reason the operator wrote with the move, and then forgets it', async () => {
    postSpy.mockResolvedValue(moved);
    await renderPage();
    await userEvent.type(
      screen.getByLabelText(en('opportunity.status.reason')),
      '  Chose a competitor.  ',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lost' }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/transition`, {
        to: 'lost',
        reason: 'Chose a competitor.',
      }),
    );
  });

  it('sends no reason when none was written', async () => {
    postSpy.mockResolvedValue(moved);
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Lost' }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/transition`, { to: 'lost' }),
    );
  });
});
