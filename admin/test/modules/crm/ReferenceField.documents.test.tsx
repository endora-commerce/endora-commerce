import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  EVERY_CRM_PERMISSION,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORDER_STATUS_GRAPH,
  QUOTE_REQUEST_ID,
  TASK_ID,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
  storedText,
} from './crm-fixtures';

/**
 * `@@` in an Opportunity's text is the shared document list
 * (`specs/163-projects-and-tasks/` FR-044, research R-14) — Orders · Quote
 * Requests · Tasks in one grouped list served by CRM's own
 * `GET /crm/lookups/documents`, the list Projects offers too. It replaces
 * `specs/143-crm-sales-opportunities/` User Story 18's `@@` = Orders.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const DOCUMENTS_PATH = '/api/v1/admin/crm/lookups/documents';
const EVERY_READ = [...EVERY_CRM_PERMISSION, 'tasks:read'];

/** A test's own answer to a GET, tried before the shared ones; `undefined` falls through. */
let intercept: ((path: string) => Promise<unknown> | undefined) | null = null;

const asked = (prefix: string): string[] =>
  getSpy.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith(prefix));

beforeEach(() => {
  getSpy.mockReset();
  intercept = null;
  getSpy.mockImplementation((path: string) => {
    const own = intercept?.(path);
    if (own) return own;
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) return Promise.resolve({ data: detail() });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith(`${DETAIL_PATH}/comments?`)) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function composer(permissions: readonly string[] = EVERY_READ): Promise<{ panel: HTMLElement; field: HTMLElement }> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    permissions,
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  await userEvent.click(screen.getByRole('tab', { name: en('opportunity.tabs.notes') }));
  const panel = await screen.findByRole('tabpanel', { name: en('opportunity.tabs.notes') });
  const field = (await within(panel).findByLabelText(en('comments.notes.composer.label'))) as HTMLElement;
  return { panel, field };
}

const documents = (panel: HTMLElement): Promise<HTMLElement> =>
  within(panel).findByRole('listbox', { name: core('references.suggest.title.document') });

describe('@@ in a text of an Opportunity', () => {
  it('opens one list grouped Orders · Quote Requests · Tasks, from CRM`s own lookup for this Opportunity', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@@');
    const list = await documents(panel);
    expect(within(list).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      core('references.group.order'),
      core('references.group.quote_request'),
      core('references.group.task'),
    ]);
    expect(within(within(list).getByRole('group', { name: core('references.group.task') })).getByRole('option')).toHaveTextContent(
      'TSK-0007',
    );
    expect(asked(DOCUMENTS_PATH)[0]).toBe(`${DOCUMENTS_PATH}?opportunityId=${OPPORTUNITY_ID}`);
    // `orders`' own list is no longer what `@@` reads.
    expect(asked('/api/v1/admin/orders?')).toEqual([]);
  });

  it('narrows the list as letters are typed, and asks with them', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@@fleet');
    await waitFor(() =>
      expect(within(panel).getAllByRole('option').map((option) => option.textContent)).toEqual([
        expect.stringContaining('TSK-0007'),
      ]),
    );
    expect(asked(DOCUMENTS_PATH)).toContain(`${DOCUMENTS_PATH}?opportunityId=${OPPORTUNITY_ID}&q=fleet`);
  });

  it('inserts a Quote Request chosen from the list as its token', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@@rfq');
    await userEvent.click(await within(panel).findByRole('option', { name: /RFQ-2001/ }));
    await waitFor(() => expect(storedText(field)).toBe(`[[quote_request:${QUOTE_REQUEST_ID}]] `));
  });

  it('inserts a Task chosen with the keyboard as its token', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, 'Next: @@tsk');
    await within(panel).findByRole('option', { name: /TSK-0007/ });
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(storedText(field)).toBe(`Next: [[task:${TASK_ID}]] `));
  });

  it('still inserts an Order of this Organization as its token', async () => {
    const { panel, field } = await composer();
    await userEvent.type(field, '@@ord');
    await userEvent.click(await within(panel).findByRole('option', { name: /ORD-1001/ }));
    await waitFor(() => expect(storedText(field)).toBe(`[[order:${ORDER_ID}]] `));
  });

  it('shows only the groups the server answers — a role reading Tasks alone gets the Tasks group', async () => {
    intercept = (path) =>
      path.startsWith(DOCUMENTS_PATH)
        ? Promise.resolve({ groups: [{ kind: 'task', items: [{ id: TASK_ID, label: 'TSK-0007' }] }] })
        : undefined;
    const { panel, field } = await composer(['crm:read', 'crm:write', 'tasks:read']);
    await userEvent.type(field, '@@');
    const list = await documents(panel);
    expect(within(list).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      core('references.group.task'),
    ]);
  });

  it('is offered to a role holding any one of the three read codes, and named among the shortcuts', async () => {
    for (const code of ['orders:read', 'rfqs:handle', 'tasks:read']) {
      const { panel } = await composer(['crm:read', 'crm:write', code]);
      const list = [core('references.shortcut.person'), core('references.shortcut.document')].join(', ');
      expect(within(panel).getByText(core('references.shortcuts', { list }))).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: core('references.insert.document') })).toBeInTheDocument();
      cleanup();
    }
  });

  // `specs/165-task-management/` R-5: the server answers the Opportunities
  // group to every writer, so `crm:read` + `crm:write` alone opens `@@`
  // (issue #498) — the own kind is a document kind like any other.
  it('opens @@ for a role holding only crm:read and crm:write, and offers the Opportunities group', async () => {
    intercept = (path) =>
      path.startsWith(DOCUMENTS_PATH)
        ? Promise.resolve({ groups: [{ kind: 'opportunity', items: [{ id: OPPORTUNITY_ID, label: 'OPP-0042' }] }] })
        : undefined;
    const { panel, field } = await composer(['crm:read', 'crm:write']);
    expect(within(panel).getByRole('button', { name: core('references.insert.document') })).toBeInTheDocument();
    await userEvent.type(field, '@@');
    const list = await documents(panel);
    expect(within(list).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual([
      core('references.group.opportunity'),
    ]);
    expect(within(list).getByRole('option')).toHaveTextContent('OPP-0042');
    expect(asked(DOCUMENTS_PATH)[0]).toBe(`${DOCUMENTS_PATH}?opportunityId=${OPPORTUNITY_ID}`);
  });

  it('the Insert document button searches the same list and inserts what is chosen', async () => {
    const { panel, field } = await composer();
    await userEvent.click(within(panel).getByRole('button', { name: core('references.insert.document') }));
    await userEvent.click(await within(panel).findByRole('combobox', { name: core('references.search.document') }));
    await userEvent.click(await screen.findByRole('option', { name: /TSK-0007/ }));
    await waitFor(() => expect(storedText(field)).toBe(`[[task:${TASK_ID}]]`));
    expect(asked(DOCUMENTS_PATH).every((path) => path.includes(`opportunityId=${OPPORTUNITY_ID}`))).toBe(true);
  });
});
