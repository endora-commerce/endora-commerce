import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import {
  ADMIN_ID,
  OPPORTUNITY_ID,
  ORDER_STATUS_GRAPH,
  ORGANIZATION_ID,
  OTHER_ADMIN_ID,
  WORKFLOW,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
  summary,
} from './crm-fixtures';

/**
 * Who holds an Opportunity, on the screens
 * (`specs/143-crm-sales-opportunities/`, User Story 3 — task T071; FR-030 –
 * FR-033): the assignee on the create form and on the Opportunity, the marker
 * of an assignee who has been deactivated, the column of the list, and the
 * "mine / unassigned / a person" filter the list and the board share.
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
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
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
const { OpportunitiesList } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunitiesList'
);
const { OpportunityBoardPage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityBoardPage'
);
const { OpportunityCreatePage } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityCreatePage'
);
const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const LIST_PATH = '/api/v1/admin/crm/opportunities';
const BOARD_PATH = '/api/v1/admin/crm/board';
const DETAIL_PATH = `${LIST_PATH}/${OPPORTUNITY_ID}`;
const SECOND_ID = '00000000-0000-4000-8000-0000000000b2';
const THIRD_ID = '00000000-0000-4000-8000-0000000000b3';

const ANNA = { id: ADMIN_ID, name: 'Anna Nowak', active: true };
const GONE = { id: OTHER_ADMIN_ID, name: 'Piotr Zielony', active: false };

let current = detail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, navigateSpy]) spy.mockReset();
  current = detail({ assignee: ANNA });
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return Promise.resolve({
        data: [
          summary({ assignee: ANNA }),
          summary({ id: SECOND_ID, number: 'OPP-000002', title: 'Warehouse racking', assignee: GONE }),
          summary({ id: THIRD_ID, number: 'OPP-000003', title: 'Depot lighting', assignee: null }),
        ],
        pagination: { cursor: null, hasMore: false, limit: 20 },
      });
    }
    if (path === BOARD_PATH || path.startsWith(`${BOARD_PATH}?`)) {
      return Promise.resolve({
        data: {
          columns: WORKFLOW.statuses.map((status) => ({
            status: { code: status.code, name: status.defaultName, color: status.color, kind: status.kind },
            count: status.code === 'new' ? 1 : 0,
            valueTotals: [],
            items: status.code === 'new' ? [summary({ assignee: GONE })] : [],
            hasMore: false,
          })),
        },
      });
    }
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/crm/tags') return Promise.resolve({ data: [] });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function queriesOf(base: string): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path === base || path.startsWith(`${base}?`))
    .map((path) => new URLSearchParams(path.split('?')[1] ?? ''));
}

function lastQuery(base: string): URLSearchParams {
  const all = queriesOf(base);
  return all[all.length - 1] as URLSearchParams;
}

async function pick(comboLabel: string, optionLabel: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(comboLabel));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(optionLabel) }));
}

describe('the assignee on the list', () => {
  async function renderList(): Promise<void> {
    renderCrm(<OpportunitiesList />, { path: '/crm/opportunities' });
    await screen.findByText('Fleet renewal');
  }

  it('shows who holds each opportunity, marks a deactivated assignee and says when there is none', async () => {
    await renderList();
    const row = (title: string): HTMLElement => screen.getByText(title).closest('tr') as HTMLElement;
    expect(within(row('Fleet renewal')).getByText('Anna Nowak')).toBeInTheDocument();
    expect(within(row('Fleet renewal')).queryByText(en('assignment.inactive'))).toBeNull();
    expect(within(row('Warehouse racking')).getByText('Piotr Zielony')).toBeInTheDocument();
    expect(within(row('Warehouse racking')).getByText(en('assignment.inactive'))).toBeInTheDocument();
    expect(within(row('Depot lighting')).getByText(en('assignment.unassigned'))).toBeInTheDocument();
  });

  it('filters by "mine", by "unassigned" and by a chosen person, and back to anyone', async () => {
    await renderList();
    expect(lastQuery(LIST_PATH).has('assignedAdminUserId')).toBe(false);
    const filter = screen.getByLabelText(en('assignment.filter.label'));

    await userEvent.selectOptions(filter, 'me');
    await waitFor(() => expect(lastQuery(LIST_PATH).get('assignedAdminUserId')).toBe('me'));

    await userEvent.selectOptions(filter, 'unassigned');
    await waitFor(() => expect(lastQuery(LIST_PATH).get('assignedAdminUserId')).toBe('unassigned'));

    // "A specific person" alone filters nothing until somebody is chosen.
    await userEvent.selectOptions(filter, 'person');
    await waitFor(() => expect(lastQuery(LIST_PATH).has('assignedAdminUserId')).toBe(false));
    await pick(en('assignment.filter.person'), 'Anna Nowak');
    await waitFor(() => expect(lastQuery(LIST_PATH).get('assignedAdminUserId')).toBe(ADMIN_ID));

    await userEvent.selectOptions(filter, '');
    await waitFor(() => expect(lastQuery(LIST_PATH).has('assignedAdminUserId')).toBe(false));
    expect(screen.queryByLabelText(en('assignment.filter.person'))).toBeNull();
  });
});

describe('the assignee on the board', () => {
  it('takes the same filter and marks a deactivated assignee on the card', async () => {
    renderCrm(<OpportunityBoardPage />, { path: '/crm/board', pattern: '/crm/board' });
    const card = (await screen.findByRole('link', { name: 'Fleet renewal' })).closest('li') as HTMLElement;
    expect(within(card).getByText('Piotr Zielony')).toBeInTheDocument();
    expect(within(card).getByText(en('assignment.inactive'))).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(en('assignment.filter.label')), 'me');
    await waitFor(() => expect(lastQuery(BOARD_PATH).get('assignedAdminUserId')).toBe('me'));
  });
});

describe('the assignee on the create form', () => {
  function renderCreate(): void {
    renderCrm(<OpportunityCreatePage />, {
      path: '/crm/opportunities/new',
      pattern: '/crm/opportunities/new',
    });
  }

  async function fillRequired(): Promise<void> {
    await userEvent.type(screen.getByLabelText(en('opportunity.field.title'), { exact: false }), 'Fleet');
    await pick(en('opportunity.field.organization'), 'Acme');
    const currency = screen.getByLabelText(en('opportunity.field.currency'), { exact: false });
    await waitFor(() => expect(currency.querySelector('option[value="PLN"]')).not.toBeNull());
    await userEvent.selectOptions(currency, 'PLN');
  }

  beforeEach(() => {
    postSpy.mockResolvedValue({ data: detail() });
  });

  it('leaves the assignee to the default rule when none is chosen', async () => {
    renderCreate();
    await fillRequired();
    expect(screen.getByText(en('assignment.create.hint'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.create.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).not.toHaveProperty('assignedAdminUserId');
  });

  it('sends the person chosen', async () => {
    renderCreate();
    await fillRequired();
    await pick(en('assignment.label'), 'Anna Nowak');
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.create.submit') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        LIST_PATH,
        expect.objectContaining({ organizationId: ORGANIZATION_ID, assignedAdminUserId: ADMIN_ID }),
      ),
    );
  });
});

describe('the assignee on the opportunity', () => {
  async function renderDetail(permissions?: readonly string[]): Promise<HTMLElement> {
    renderCrm(<OpportunityDetail />, {
      path: `/crm/opportunities/${OPPORTUNITY_ID}`,
      pattern: '/crm/opportunities/:id',
      ...(permissions ? { permissions } : {}),
    });
    await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
    return screen.findByRole('region', { name: en('assignment.label') });
  }

  it('names the assignee, and marks one who has been deactivated', async () => {
    current = detail({ assignee: GONE });
    const section = await renderDetail(['crm:read', 'orders:read']);
    expect(within(section).getByText('Piotr Zielony')).toBeInTheDocument();
    expect(within(section).getByText(en('assignment.inactive'))).toBeInTheDocument();
    // A reader is shown who holds it and offered nothing to change.
    expect(within(section).queryByRole('combobox')).toBeNull();
  });

  it('says so when nobody holds it', async () => {
    current = detail({ assignee: null });
    const section = await renderDetail(['crm:read', 'orders:read']);
    expect(within(section).getByText(en('assignment.unassigned'))).toBeInTheDocument();
  });

  it('reassigns to the person chosen and shows the answer', async () => {
    postSpy.mockResolvedValue({
      data: detail({ assignee: { id: OTHER_ADMIN_ID, name: 'Piotr Zielony', active: true }, version: 2 }),
    });
    const section = await renderDetail();
    expect(within(section).getByLabelText(en('assignment.change'))).toHaveValue('Anna Nowak');
    await userEvent.click(within(section).getByLabelText(en('assignment.change')));
    await userEvent.click(await screen.findByRole('option', { name: /Piotr Zielony/ }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/assign`, { adminUserId: OTHER_ADMIN_ID }),
    );
    await waitFor(() =>
      expect(within(section).getByLabelText(en('assignment.change'))).toHaveValue('Piotr Zielony'),
    );
    expect(within(section).getByRole('status')).toHaveTextContent(en('assignment.saved'));
  });

  it('unassigns when the choice is cleared', async () => {
    postSpy.mockResolvedValue({ data: detail({ assignee: null, version: 2 }) });
    const section = await renderDetail();
    await userEvent.click(
      within(section).getByRole('button', { name: core('common.combobox.clearSelection') }),
    );
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/assign`, { adminUserId: null }),
    );
    await waitFor(() =>
      expect(within(section).getByRole('status')).toHaveTextContent(en('assignment.cleared')),
    );
  });

  it('shows the refusal and keeps the assignee when the person cannot be assigned', async () => {
    postSpy.mockRejectedValue(
      new ApiError(422, {
        error: { code: 'CRM_ASSIGNEE_INVALID', message: 'This person cannot be assigned.' },
      }),
    );
    const section = await renderDetail();
    await userEvent.click(within(section).getByLabelText(en('assignment.change')));
    await userEvent.click(await screen.findByRole('option', { name: /Piotr Zielony/ }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('This person cannot be assigned.');
    expect(within(section).getByLabelText(en('assignment.change'))).toHaveValue('Anna Nowak');
  });
});
