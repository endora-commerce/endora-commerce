import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityComment } from '@endora-commerce/contracts';
import {
  OPPORTUNITY_ID,
  ORDER_STATUS_GRAPH,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
} from './crm-fixtures';

/**
 * Notes and internal messages on the Opportunity screen
 * (`specs/143-crm-sales-opportunities/`, User Story 4 — task T076; FR-040 –
 * FR-043): two tabs over one composer. A note can be edited and deleted by the
 * person who wrote it and by nobody else; a message cannot be changed by
 * anybody once it is sent.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

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

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const COMMENTS_PATH = `${DETAIL_PATH}/comments`;
/** The signed-in administrator of `adminSession` — the author of "mine". */
const ME = '00000000-0000-4000-8000-00000000ad01';
const COLLEAGUE = '00000000-0000-4000-8000-00000000ad09';
const ID = (n: number): string => `00000000-0000-4000-8000-0000000c000${n}`;

function comment(overrides: Partial<OpportunityComment>): OpportunityComment {
  return {
    id: ID(1),
    kind: 'note',
    author: { id: ME, name: 'Ada Min' },
    body: 'Call back on Friday.',
    references: [],
    editedAt: null,
    createdAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  };
}

let notes: OpportunityComment[];
let messages: OpportunityComment[];
let failList = false;

beforeEach(() => {
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  notes = [
    comment({ id: ID(1), body: 'Call back on Friday.' }),
    comment({
      id: ID(2),
      author: { id: COLLEAGUE, name: 'Piotr Zielony' },
      body: 'They want forty vans.',
      editedAt: '2026-10-05T11:30:00.000Z',
      createdAt: '2026-10-05T11:00:00.000Z',
    }),
  ];
  messages = [
    comment({ id: ID(3), kind: 'message', body: 'Who sends the offer?' }),
    comment({
      id: ID(4),
      kind: 'message',
      author: { id: COLLEAGUE, name: 'Piotr Zielony' },
      body: 'I will.',
      createdAt: '2026-10-05T12:00:00.000Z',
    }),
  ];
  failList = false;
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: detail() });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith(`${COMMENTS_PATH}?`)) {
      if (failList) {
        return Promise.reject(new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } }));
      }
      return Promise.resolve({ data: path.endsWith('kind=note') ? notes : messages });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function openTab(
  label: string,
  permissions?: readonly string[],
): Promise<HTMLElement> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  await userEvent.click(screen.getByRole('tab', { name: label }));
  return screen.findByRole('tabpanel', { name: label });
}

const entry = (panel: HTMLElement, text: string): HTMLElement =>
  within(panel).getByText(text).closest('li') as HTMLElement;

describe('the Notes tab', () => {
  const open = (permissions?: readonly string[]): Promise<HTMLElement> =>
    openTab(en('opportunity.tabs.notes'), permissions);

  it('lists the notes oldest first, with who wrote each and whether it was edited', async () => {
    const panel = await open();
    await within(panel).findByText('Call back on Friday.');
    expect(getSpy).toHaveBeenCalledWith(`${COMMENTS_PATH}?kind=note`);
    const items = within(panel).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('Ada Min')).toBeInTheDocument();
    expect(within(items[0] as HTMLElement).queryByText(en('comments.edited'))).toBeNull();
    expect(within(items[1] as HTMLElement).getByText('Piotr Zielony')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText(en('comments.edited'))).toBeInTheDocument();
  });

  it('offers edit and delete on the author\'s own note and on nobody else\'s', async () => {
    const panel = await open();
    const mine = entry(panel, 'Call back on Friday.');
    const theirs = entry(panel, 'They want forty vans.');
    expect(within(mine).getByRole('button', { name: en('comments.edit') })).toBeInTheDocument();
    expect(within(mine).getByRole('button', { name: en('comments.delete') })).toBeInTheDocument();
    expect(within(theirs).queryByRole('button', { name: en('comments.edit') })).toBeNull();
    expect(within(theirs).queryByRole('button', { name: en('comments.delete') })).toBeNull();
  });

  it('says there are no notes yet', async () => {
    notes = [];
    const panel = await open();
    expect(await within(panel).findByText(en('comments.notes.empty'))).toBeInTheDocument();
  });

  it('says the notes could not be loaded and tries again', async () => {
    failList = true;
    const panel = await open();
    expect(await within(panel).findByText('Boom.')).toBeInTheDocument();
    failList = false;
    await userEvent.click(within(panel).getByRole('button', { name: core('common.action.retry') }));
    expect(await within(panel).findByText('Call back on Friday.')).toBeInTheDocument();
  });

  it('adds a note and clears the composer', async () => {
    const added = comment({ id: ID(5), body: 'Budget approved.', createdAt: '2026-10-05T13:00:00.000Z' });
    postSpy.mockResolvedValue({ data: added });
    const panel = await open();
    const field = within(panel).getByLabelText(en('comments.notes.composer.label'));
    await userEvent.type(field, 'Budget approved.');
    await userEvent.click(within(panel).getByRole('button', { name: en('comments.notes.composer.submit') }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(COMMENTS_PATH, { kind: 'note', body: 'Budget approved.' }),
    );
    expect(await within(panel).findByText('Budget approved.')).toBeInTheDocument();
    expect(field).toHaveValue('');
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3);
  });

  it('refuses an empty note without calling the server', async () => {
    const panel = await open();
    await userEvent.click(within(panel).getByRole('button', { name: en('comments.notes.composer.submit') }));
    expect(within(panel).getByText(en('comments.error.empty'))).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('edits the author\'s own note in place', async () => {
    patchSpy.mockResolvedValue({
      data: comment({ id: ID(1), body: 'Call back on Monday.', editedAt: '2026-10-05T14:00:00.000Z' }),
    });
    const panel = await open();
    await userEvent.click(
      within(entry(panel, 'Call back on Friday.')).getByRole('button', { name: en('comments.edit') }),
    );
    const field = within(panel).getByLabelText(en('comments.edit.label'));
    expect(field).toHaveValue('Call back on Friday.');
    await userEvent.clear(field);
    await userEvent.type(field, 'Call back on Monday.');
    await userEvent.click(within(panel).getByRole('button', { name: core('common.action.save') }));

    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(`${COMMENTS_PATH}/${ID(1)}`, { body: 'Call back on Monday.' }),
    );
    const edited = await within(panel).findByText('Call back on Monday.');
    expect(within(edited.closest('li') as HTMLElement).getByText(en('comments.edited'))).toBeInTheDocument();
  });

  it('shows the refusal when an edit is not accepted, and keeps what was typed', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(403, { error: { code: 'FORBIDDEN', message: 'Only the author may change a note.' } }),
    );
    const panel = await open();
    await userEvent.click(
      within(entry(panel, 'Call back on Friday.')).getByRole('button', { name: en('comments.edit') }),
    );
    const field = within(panel).getByLabelText(en('comments.edit.label'));
    await userEvent.type(field, ' Really.');
    await userEvent.click(within(panel).getByRole('button', { name: core('common.action.save') }));
    expect(await within(panel).findByText('Only the author may change a note.')).toBeInTheDocument();
    expect(field).toHaveValue('Call back on Friday. Really.');
  });

  it('deletes the author\'s own note after asking', async () => {
    deleteSpy.mockResolvedValue(undefined);
    const panel = await open();
    await userEvent.click(
      within(entry(panel, 'Call back on Friday.')).getByRole('button', { name: en('comments.delete') }),
    );
    const dialog = screen.getByRole('dialog', { name: en('comments.delete.title') });
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: en('comments.delete.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${COMMENTS_PATH}/${ID(1)}`));
    await waitFor(() => expect(within(panel).queryByText('Call back on Friday.')).toBeNull());
    expect(within(panel).getByText('They want forty vans.')).toBeInTheDocument();
  });

  it('shows a reader the notes and nothing to write with', async () => {
    const panel = await open(['crm:read', 'orders:read']);
    await within(panel).findByText('Call back on Friday.');
    expect(within(panel).queryByLabelText(en('comments.notes.composer.label'))).toBeNull();
    expect(within(panel).queryByRole('button', { name: en('comments.edit') })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en('comments.delete') })).toBeNull();
  });
});

describe('the Messages tab', () => {
  const open = (permissions?: readonly string[]): Promise<HTMLElement> =>
    openTab(en('opportunity.tabs.messages'), permissions);

  it('lists the conversation and offers no way to change a message — not even one\'s own', async () => {
    const panel = await open();
    await within(panel).findByText('Who sends the offer?');
    expect(getSpy).toHaveBeenCalledWith(`${COMMENTS_PATH}?kind=message`);
    expect(within(panel).getAllByRole('listitem')).toHaveLength(2);
    expect(within(panel).queryByRole('button', { name: en('comments.edit') })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en('comments.delete') })).toBeNull();
    expect(within(panel).getByText(en('comments.messages.hint'))).toBeInTheDocument();
  });

  it('sends a message', async () => {
    postSpy.mockResolvedValue({
      data: comment({ id: ID(6), kind: 'message', body: 'Sent today.', createdAt: '2026-10-05T15:00:00.000Z' }),
    });
    const panel = await open();
    await userEvent.type(within(panel).getByLabelText(en('comments.messages.composer.label')), 'Sent today.');
    await userEvent.click(
      within(panel).getByRole('button', { name: en('comments.messages.composer.submit') }),
    );
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(COMMENTS_PATH, { kind: 'message', body: 'Sent today.' }),
    );
    expect(await within(panel).findByText('Sent today.')).toBeInTheDocument();
    expect(within(panel).getByRole('status')).toHaveTextContent(en('comments.messages.added'));
  });

  it('says there are no messages yet', async () => {
    messages = [];
    const panel = await open();
    expect(await within(panel).findByText(en('comments.messages.empty'))).toBeInTheDocument();
  });
});
