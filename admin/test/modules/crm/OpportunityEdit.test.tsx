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
  editorOf,
  renderCrm,
  storedText,
} from './crm-fixtures';

/**
 * Editing and deleting an Opportunity, and the reason of a status change
 * (`specs/158-crm-opportunity-inline-editing/` FR-001 – FR-004;
 * `specs/143-crm-sales-opportunities/`, User Story 1 — task T181; FR-005,
 * `contracts/admin-api.md` §1–§2).
 *
 * Three subjects. Every field is edited where it is shown, and a save sends
 * that field alone, under the version it was read at. A stale version is
 * **said**, the newer Opportunity is put on screen, and the draft is saved
 * against it only when the operator asks again — never retried behind their
 * back. Deleting is offered to a holder of `crm:configure` and asks first.
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
  // The tab is a lazy component: its sections arrive one tick after the header.
  await screen.findByRole('heading', { level: 2, name: en('opportunity.field.description') });
}

/** The pencil beside a field, named "Edit <field>". */
function pencil(field: string): HTMLElement {
  return screen.getByRole('button', { name: en('inlineEdit.edit', { field }) });
}

function save(): Promise<void> {
  return userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
}

/** A status the workflow allows from here is a button of the stage bar, named by what it does. */
const MOVE_TO_LOST = en('opportunity.stage.moveToClosing', {
  status: 'Lost',
  outcome: en('opportunity.stage.kind.lost'),
});

const IF_MATCH_1 = { headers: { 'If-Match': '"1"' } };

describe('OpportunityDetail — editing in place (specs/158-crm-opportunity-inline-editing/)', () => {
  const TITLE = en('opportunity.field.title');
  const DESCRIPTION = en('opportunity.field.description');
  const CLOSE_DATE = en('opportunity.field.expectedCloseDate');
  const CONTACT = en('opportunity.field.contact');
  const CHANNEL = en('opportunity.field.salesChannel');
  const VALUE = en('value.title');

  it('offers no pencil to an operator who may only read, and no edit form to anybody', async () => {
    await renderPage(['crm:read', 'orders:read']);
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('offers a pencil beside every field that can change, and none beside one that cannot', async () => {
    await renderPage();
    for (const field of [TITLE, DESCRIPTION, CLOSE_DATE, CONTACT, CHANNEL, VALUE]) {
      expect(pencil(field)).toBeInTheDocument();
    }
    for (const fixed of ['opportunity.field.organization', 'opportunity.field.source', 'opportunity.field.number']) {
      expect(screen.queryByRole('button', { name: en('inlineEdit.edit', { field: en(fixed) }) })).toBeNull();
    }
  });

  it('edits the title in place: the current title, Enter saves it alone under the version read', async () => {
    patchSpy.mockResolvedValue({ data: detail({ title: 'Fleet renewal 2027', version: 2 }) });
    await renderPage();
    await userEvent.click(pencil(TITLE));
    const field = screen.getByRole('textbox', { name: TITLE });
    expect(field).toHaveValue('Fleet renewal');
    expect(field).toHaveFocus();
    // The heading stays a heading while its words are edited.
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet renewal' })).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, 'Fleet renewal 2027{Enter}');

    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(DETAIL_PATH, { title: 'Fleet renewal 2027' }, IF_MATCH_1),
    );
    expect(await screen.findByRole('heading', { level: 1, name: /Fleet renewal 2027/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: TITLE })).toBeNull();
    expect(await screen.findByText(en('inlineEdit.saved', { field: TITLE }))).toBeInTheDocument();
    await waitFor(() => expect(pencil(TITLE)).toHaveFocus());
  });

  it('refuses an empty title without a request, and Escape leaves it as it was', async () => {
    await renderPage();
    await userEvent.click(pencil(TITLE));
    const field = screen.getByRole('textbox', { name: TITLE });
    await userEvent.clear(field);
    await save();
    expect(screen.getByText(en('opportunity.create.error.title'))).toHaveAttribute('role', 'alert');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: TITLE })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /Fleet renewal/ })).toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('edits the description in the formatted field, in its own section, and sends it alone', async () => {
    patchSpy.mockResolvedValue({ data: detail({ description: '**Forty** vans.', version: 2 }) });
    await renderPage();
    await userEvent.click(pencil(DESCRIPTION));
    const field = screen.getByRole('textbox', { name: DESCRIPTION });
    expect(storedText(field)).toBe('Forty vans over two years.');
    expect(screen.getByRole('toolbar', { name: core('editor.toolbar') })).toBeInTheDocument();
    editorOf(field).commands.setContent('<p><strong>Forty</strong> vans.</p>');
    await save();
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(DETAIL_PATH, { description: '**Forty** vans.' }, IF_MATCH_1),
    );
    expect((await screen.findByText('Forty')).tagName).toBe('STRONG');
  });

  it('sends null for a description that was emptied', async () => {
    patchSpy.mockResolvedValue({ data: detail({ description: null, version: 2 }) });
    await renderPage();
    await userEvent.click(pencil(DESCRIPTION));
    editorOf(screen.getByRole('textbox', { name: DESCRIPTION })).commands.clearContent(true);
    await save();
    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(DETAIL_PATH, { description: null }, IF_MATCH_1));
  });

  it('edits the expected close date in the sidebar, and clears it as null', async () => {
    patchSpy.mockResolvedValue({ data: detail({ expectedCloseDate: null, version: 2 }) });
    await renderPage();
    await userEvent.click(pencil(CLOSE_DATE));
    const field = screen.getByLabelText(CLOSE_DATE);
    expect(field).toHaveValue('2026-12-01');
    await userEvent.clear(field);
    await save();
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(DETAIL_PATH, { expectedCloseDate: null }, IF_MATCH_1),
    );
  });

  it('chooses another contact person — of this Organization only — and a sales channel, each saved alone', async () => {
    current = detail({ customerAccount: { id: CONTACT_ID, name: 'Jan Kowalski', email: 'jan@acme.test' } });
    patchSpy.mockResolvedValue({ data: detail({ version: 2 }) });
    await renderPage();
    await userEvent.click(pencil(CONTACT));
    // The picker opens on the focus it is given, listing this Organization's people.
    await userEvent.click(screen.getByLabelText(CONTACT));
    expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/crm/lookups/contacts?organizationId=${ORGANIZATION_ID}`);
    await userEvent.click(await screen.findByRole('option', { name: /Ewa Inna/ }));
    await save();
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(DETAIL_PATH, { customerAccountId: OTHER_CONTACT_ID }, IF_MATCH_1),
    );

    expect(await screen.findByText(en('inlineEdit.saved', { field: CONTACT }))).toBeInTheDocument();
    await userEvent.click(pencil(CHANNEL));
    await userEvent.click(screen.getByRole('combobox', { name: CHANNEL }));
    await userEvent.click(await screen.findByRole('option', { name: /Wholesale/ }));
    await save();
    await waitFor(() =>
      expect(patchSpy).toHaveBeenLastCalledWith(DETAIL_PATH, { salesChannelId: CHANNEL_ID }, { headers: { 'If-Match': '"2"' } }),
    );
  });

  it('edits a typed value where it is read, taking what a Polish keyboard produces, and refuses what is no amount', async () => {
    patchSpy.mockResolvedValue({ data: detail({ manualValue: '14000.50', version: 2 }) });
    await renderPage();
    await userEvent.click(pencil(VALUE));
    const field = screen.getByRole('textbox', { name: VALUE });
    expect(field).toHaveValue('12500.00');
    await userEvent.clear(field);
    await userEvent.type(field, 'a lot');
    await save();
    expect(screen.getByText(en('opportunity.create.error.value'))).toHaveAttribute('role', 'alert');
    expect(patchSpy).not.toHaveBeenCalled();
    await userEvent.clear(field);
    await userEvent.type(field, '14 000,5{Enter}');
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(DETAIL_PATH, { manualValue: '14000.50' }, IF_MATCH_1),
    );
  });

  it('offers no pencil on a computed value — the documents make it', async () => {
    current = detail({ valueMode: 'computed' });
    await renderPage();
    expect(screen.queryByRole('button', { name: en('inlineEdit.edit', { field: VALUE }) })).toBeNull();
  });

  it('opens a field that holds no value yet — a Sales Channel never chosen', async () => {
    await renderPage();
    await userEvent.click(pencil(CHANNEL));
    expect(screen.getByRole('combobox', { name: CHANNEL })).toBeInTheDocument();
  });

  it('makes no request when nothing was changed, and discards a draft on Cancel', async () => {
    await renderPage();
    await userEvent.click(pencil(CLOSE_DATE));
    await save();
    await waitFor(() => expect(screen.queryByLabelText(CLOSE_DATE)).toBeNull());
    await userEvent.click(pencil(TITLE));
    await userEvent.type(screen.getByRole('textbox', { name: TITLE }), ' X');
    await userEvent.click(screen.getByRole('button', { name: core('common.action.cancel') }));
    expect(screen.queryByRole('textbox', { name: TITLE })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /^Fleet renewal/ })).toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('says so when somebody else saved first, shows their version, and saves the draft only when asked again', async () => {
    patchSpy.mockRejectedValueOnce(
      new ApiError(409, {
        error: { code: 'VERSION_CONFLICT', message: 'The opportunity was updated concurrently.' },
      }),
    );
    await renderPage();
    await userEvent.click(pencil(TITLE));
    const field = screen.getByRole('textbox', { name: TITLE });
    await userEvent.clear(field);
    await userEvent.type(field, 'Mine');
    current = detail({ title: 'Theirs', version: 5 });
    await save();

    expect(await screen.findByText(en('inlineEdit.conflict'))).toHaveAttribute('role', 'alert');
    // Their version was read and is what the page now holds; the draft is kept.
    expect(screen.getByRole('textbox', { name: TITLE })).toHaveValue('Mine');
    expect(screen.getByRole('heading', { level: 1, name: /Theirs/ })).toBeInTheDocument();
    expect(patchSpy).toHaveBeenCalledTimes(1);

    patchSpy.mockResolvedValueOnce({ data: detail({ title: 'Mine', version: 6 }) });
    await save();
    await waitFor(() =>
      expect(patchSpy).toHaveBeenLastCalledWith(DETAIL_PATH, { title: 'Mine' }, { headers: { 'If-Match': '"5"' } }),
    );
  });

  it('shows the server\'s own sentence for any other refusal and keeps the draft', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: { code: 'VALIDATION_FAILED', message: 'The sales channel does not exist.' },
      }),
    );
    await renderPage();
    await userEvent.click(pencil(TITLE));
    const field = screen.getByRole('textbox', { name: TITLE });
    await userEvent.type(field, ' B');
    await save();
    expect(await screen.findByText('The sales channel does not exist.')).toBeInTheDocument();
    expect(field).toHaveValue('Fleet renewal B');
    expect(screen.getByRole('button', { name: core('common.action.save') })).toBeEnabled();
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
    await userEvent.click(await screen.findByRole('button', { name: en('opportunity.status.addReason') }));
    await userEvent.type(
      screen.getByLabelText(en('opportunity.status.reason')),
      '  Chose a competitor.  ',
    );
    await userEvent.click(await screen.findByRole('button', { name: MOVE_TO_LOST }));
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
    await userEvent.click(await screen.findByRole('button', { name: MOVE_TO_LOST }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/transition`, { to: 'lost' }),
    );
  });
});
