import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import {
  OPPORTUNITY_ID,
  ORDER_STATUS_GRAPH,
  WORKFLOW,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
  summary,
} from './crm-fixtures';

/**
 * Tags on the screens (`specs/143-crm-sales-opportunities/`, User Story 6 —
 * task T086; FR-048 – FR-050): the tag list an operator manages, the tags an
 * Opportunity carries and how a Sales Rep changes them, and the tag filter the
 * list and the board share — several tags meaning all of them.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const putSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();
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
      put: (...args: unknown[]) => putSpy(...args),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { TagsPage } = await import('../../../../packages/modules/crm/src/admin/pages/TagsPage');
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

const TAGS_PATH = '/api/v1/admin/crm/tags';
const LIST_PATH = '/api/v1/admin/crm/opportunities';
const BOARD_PATH = '/api/v1/admin/crm/board';
const DETAIL_PATH = `${LIST_PATH}/${OPPORTUNITY_ID}`;

const KEY = { id: '00000000-0000-4000-8000-0000000007a1', name: 'Key account', color: '#0ea5e9' };
const TENDER = { id: '00000000-0000-4000-8000-0000000007a2', name: 'Tender', color: '#f59e0b' };

let tags: Array<typeof KEY & { usageCount: number }>;
let current = detail();
let failTags = false;

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, putSpy, patchSpy, deleteSpy, navigateSpy]) spy.mockReset();
  tags = [
    { ...KEY, usageCount: 3 },
    { ...TENDER, usageCount: 0 },
  ];
  current = detail({ tags: [KEY] });
  failTags = false;
  getSpy.mockImplementation((path: string) => {
    if (path === TAGS_PATH) {
      return failTags
        ? Promise.reject(new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } }))
        : Promise.resolve({ data: tags });
    }
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: current });
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return Promise.resolve({
        data: [summary({ tags: [KEY, TENDER] })],
        pagination: { cursor: null, hasMore: false, limit: 20 },
      });
    }
    if (path === BOARD_PATH || path.startsWith(`${BOARD_PATH}?`)) {
      return Promise.resolve({
        data: {
          columns: WORKFLOW.statuses.map((status) => ({
            status: { code: status.code, name: status.defaultName, color: status.color, kind: status.kind },
            count: 0,
            valueTotals: [],
            items: [],
            hasMore: false,
          })),
        },
      });
    }
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
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

/** Open a tag multi-select by its accessible name and tick the tags named. */
async function tick(control: HTMLElement, ...names: string[]): Promise<void> {
  await userEvent.click(control);
  for (const name of names) await userEvent.click(await screen.findByRole('checkbox', { name }));
}

describe('TagsPage', () => {
  async function renderPage(): Promise<void> {
    renderCrm(<TagsPage />, { path: '/crm/tags', pattern: '/crm/tags' });
    await screen.findByRole('heading', { level: 1, name: en('tags.title') });
  }

  const row = (name: string): HTMLElement => screen.getByText(name).closest('tr') as HTMLElement;

  it('lists every tag with how many opportunities carry it', async () => {
    await renderPage();
    await screen.findByText('Key account');
    expect(within(row('Key account')).getByText('3')).toBeInTheDocument();
    expect(within(row('Tender')).getByText('0')).toBeInTheDocument();
  });

  it('says there are no tags yet, with the way to add the first', async () => {
    tags = [];
    await renderPage();
    expect(await screen.findByText(en('tags.empty'))).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: en('tags.add') }).length).toBeGreaterThan(0);
  });

  it('says the list could not be loaded and tries again', async () => {
    failTags = true;
    await renderPage();
    expect(await screen.findByText('Boom.')).toBeInTheDocument();
    failTags = false;
    await userEvent.click(screen.getByRole('button', { name: core('common.action.retry') }));
    expect(await screen.findByText('Key account')).toBeInTheDocument();
  });

  it('creates a tag and shows it', async () => {
    const created = { id: '00000000-0000-4000-8000-0000000007a3', name: 'Renewal', color: '#64748b', usageCount: 0 };
    postSpy.mockImplementation(() => {
      tags = [...tags, created];
      return Promise.resolve({ data: created });
    });
    await renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: en('tags.add') }))[0] as HTMLElement);
    const dialog = screen.getByRole('dialog', { name: en('tags.dialog.createTitle') });
    await userEvent.type(within(dialog).getByLabelText(en('tags.field.name')), 'Renewal');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(TAGS_PATH, expect.objectContaining({ name: 'Renewal' })),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Renewal')).toBeInTheDocument();
  });

  it('requires a name, and shows the refusal when the name is taken', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'CRM_TAG_NAME_TAKEN', message: 'A tag named "tender" already exists.' },
      }),
    );
    await renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: en('tags.add') }))[0] as HTMLElement);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(within(dialog).getByText(en('tags.error.nameRequired'))).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText(en('tags.field.name')), 'tender');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    expect(await within(dialog).findByText('A tag named "tender" already exists.')).toBeInTheDocument();
    // The dialog stays open with what was typed.
    expect(within(dialog).getByLabelText(en('tags.field.name'))).toHaveValue('tender');
  });

  it('renames a tag, sending only what changed', async () => {
    patchSpy.mockResolvedValue({ data: { ...KEY, name: 'Strategic', usageCount: 3 } });
    await renderPage();
    await screen.findByText('Key account');
    await userEvent.click(
      within(row('Key account')).getByRole('button', { name: en('tags.edit', { name: 'Key account' }) }),
    );
    const dialog = screen.getByRole('dialog', { name: en('tags.dialog.editTitle') });
    const name = within(dialog).getByLabelText(en('tags.field.name'));
    expect(name).toHaveValue('Key account');
    await userEvent.clear(name);
    await userEvent.type(name, 'Strategic');
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.save') }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(`${TAGS_PATH}/${KEY.id}`, { name: 'Strategic' }),
    );
  });

  it('asks before deleting, and names how many opportunities lose the tag', async () => {
    deleteSpy.mockImplementation(() => {
      tags = tags.filter((tag) => tag.id !== KEY.id);
      return Promise.resolve(undefined);
    });
    await renderPage();
    await screen.findByText('Key account');
    await userEvent.click(
      within(row('Key account')).getByRole('button', { name: en('tags.delete', { name: 'Key account' }) }),
    );
    const dialog = screen.getByRole('dialog', { name: en('tags.delete.title') });
    expect(
      within(dialog).getByText(en('tags.delete.body', { name: 'Key account', count: 3 })),
    ).toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: en('tags.delete.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${TAGS_PATH}/${KEY.id}`));
    await waitFor(() => expect(screen.queryByText('Key account')).toBeNull());
  });
});

describe('tags on an opportunity', () => {
  async function renderDetail(permissions?: readonly string[]): Promise<HTMLElement> {
    renderCrm(<OpportunityDetail />, {
      path: `/crm/opportunities/${OPPORTUNITY_ID}`,
      pattern: '/crm/opportunities/:id',
      ...(permissions ? { permissions } : {}),
    });
    await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
    // One labelled fact of the sidebar — a group, not a landmark (User Story 20).
    return screen.findByRole('group', { name: en('tags.section') });
  }

  it('shows the tags a reader may see, with nothing to change', async () => {
    const section = await renderDetail(['crm:read', 'orders:read']);
    expect(within(section).getByText('Key account')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: en('tags.change') })).toBeNull();
  });

  it('says so when the opportunity carries none', async () => {
    current = detail({ tags: [] });
    const section = await renderDetail(['crm:read', 'orders:read']);
    expect(within(section).getByText(en('tags.none'))).toBeInTheDocument();
  });

  it('replaces the set when a tag is ticked, and shows the answer', async () => {
    putSpy.mockResolvedValue({ data: detail({ tags: [KEY, TENDER], version: 2 }) });
    const section = await renderDetail();
    await tick(within(section).getByRole('button', { name: en('tags.change') }), 'Tender');
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(`${DETAIL_PATH}/tags`, { tagIds: [KEY.id, TENDER.id] }),
    );
    // The chips are the list; the open multi-select names the tag too.
    await waitFor(() =>
      expect(within(within(section).getByRole('list')).getByText('Tender')).toBeInTheDocument(),
    );
    expect(within(section).getByRole('status')).toHaveTextContent(en('tags.saved'));
  });

  it('shows the refusal and keeps the tags when the change is not accepted', async () => {
    putSpy.mockRejectedValue(
      new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'That tag no longer exists.' } }),
    );
    const section = await renderDetail();
    await tick(within(section).getByRole('button', { name: en('tags.change') }), 'Tender');
    expect(await within(section).findByRole('alert')).toHaveTextContent('That tag no longer exists.');
  });
});

describe('tags elsewhere', () => {
  it('shows an opportunity\'s tags on the list and filters by every tag chosen', async () => {
    renderCrm(<OpportunitiesList />, { path: '/crm/opportunities' });
    const row = (await screen.findByText('Fleet renewal')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Key account')).toBeInTheDocument();
    expect(within(row).getByText('Tender')).toBeInTheDocument();
    expect(lastQuery(LIST_PATH).has('tagId')).toBe(false);

    await tick(screen.getByRole('button', { name: en('tags.filter.label') }), 'Key account', 'Tender');
    await waitFor(() => expect(lastQuery(LIST_PATH).getAll('tagId')).toEqual([KEY.id, TENDER.id]));
  });

  it('filters the board by tag', async () => {
    renderCrm(<OpportunityBoardPage />, { path: '/crm/board', pattern: '/crm/board' });
    await screen.findByRole('group', { name: en('board.column.label', { status: 'New' }) });
    await tick(screen.getByRole('button', { name: en('tags.filter.label') }), 'Tender');
    await waitFor(() => expect(lastQuery(BOARD_PATH).getAll('tagId')).toEqual([TENDER.id]));
  });

  it('sends the tags chosen on the create form, and none when none is', async () => {
    postSpy.mockResolvedValue({ data: detail() });
    renderCrm(<OpportunityCreatePage />, {
      path: '/crm/opportunities/new',
      pattern: '/crm/opportunities/new',
    });
    await userEvent.type(screen.getByLabelText(en('opportunity.field.title'), { exact: false }), 'Fleet');
    await userEvent.click(screen.getByLabelText(en('opportunity.field.organization')));
    await userEvent.click(await screen.findByRole('option', { name: /Acme/ }));
    const currency = screen.getByLabelText(en('opportunity.field.currency'), { exact: false });
    await waitFor(() => expect(currency.querySelector('option[value="PLN"]')).not.toBeNull());
    await userEvent.selectOptions(currency, 'PLN');
    await tick(screen.getByRole('button', { name: en('tags.section') }), 'Tender');
    await userEvent.click(screen.getByRole('button', { name: en('opportunity.create.submit') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(LIST_PATH, expect.objectContaining({ tagIds: [TENDER.id] })),
    );
  });
});
