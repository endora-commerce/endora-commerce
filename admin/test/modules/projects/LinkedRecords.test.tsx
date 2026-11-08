import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectDetail, ProjectLink } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { ORGANIZATION_ID, PROJECT_ID, detail, en, renderProjects } from './projects-fixtures';

/**
 * A Project's *Linked records* tab (`specs/163-projects-and-tasks/`, User
 * Story 6 — tasks T091 and T096; `contracts/admin-surfaces.md` §2, spec
 * FR-021 – FR-024).
 *
 * Orders, Quote Requests and Opportunities, a group each. A record is shown
 * with its number (a link to it), status and amount — or as *unavailable*
 * when the reader may not read it, it is gone, or its module is off. A writer
 * links a record of one of the Project's Organizations through a picker per
 * kind, offered only while the kind's module is on and the writer holds the
 * code that module reads its records with, and unlinks any record.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
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
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { LinkedRecordsTab } = await import(
  '../../../../packages/modules/projects/src/admin/pages/project-detail/tabs/LinkedRecordsTab'
);

const LINKS_PATH = `/api/v1/admin/projects/${PROJECT_ID}/links`;
const SECOND_ORG = '00000000-0000-4000-8000-0000000000a2';
const ORDER_ID = '00000000-0000-4000-8000-0000000000c1';
const FREE_ORDER_ID = '00000000-0000-4000-8000-0000000000c2';
const QUOTE_ID = '00000000-0000-4000-8000-0000000000c3';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-0000000000c4';

const ALL_READ = ['projects:read', 'projects:write', 'orders:read', 'rfqs:handle', 'crm:read'];
const EVERY_OWNER = ['projects', 'orders', 'quote_requests', 'crm'];

function link(overrides: Partial<ProjectLink> & Pick<ProjectLink, 'id' | 'kind' | 'recordId'>): ProjectLink {
  return { available: false, linkedBy: null, linkedAt: '2026-10-26T10:00:00.000Z', ...overrides };
}

let links: ProjectLink[];

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, deleteSpy]) spy.mockReset();
  links = [
    link({
      id: '00000000-0000-4000-8000-0000000001a1',
      kind: 'order',
      recordId: ORDER_ID,
      available: true,
      number: 'ORD-1001',
      status: 'new',
      amount: '321.00',
      currency: 'PLN',
      href: `/orders/${ORDER_ID}`,
    }),
    link({ id: '00000000-0000-4000-8000-0000000001a2', kind: 'quote_request', recordId: QUOTE_ID }),
    link({
      id: '00000000-0000-4000-8000-0000000001a3',
      kind: 'opportunity',
      recordId: OPPORTUNITY_ID,
      available: true,
      number: 'OPP-000007',
      status: 'proposal',
      href: `/crm/opportunities/${OPPORTUNITY_ID}`,
    }),
  ];
  getSpy.mockImplementation((path: string) => {
    if (path === LINKS_PATH) return Promise.resolve({ data: links });
    if (path.startsWith('/api/v1/admin/orders?')) {
      return Promise.resolve({ data: [{ id: FREE_ORDER_ID, businessId: 'ORD-1002', status: 'new', total: 10, currency: 'PLN' }] });
    }
    if (path.startsWith('/api/v1/admin/quote-requests?')) return Promise.resolve({ data: [] });
    if (path.startsWith('/api/v1/admin/crm/opportunities?')) return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return detail({ organizations: [{ id: ORGANIZATION_ID, name: 'Acme' }], ...overrides });
}

async function renderTab(
  options: { project?: ProjectDetail; permissions?: readonly string[]; present?: readonly string[] } = {},
): Promise<void> {
  renderProjects(<LinkedRecordsTab project={options.project ?? project()} onChange={vi.fn()} reload={vi.fn(async () => {})} />, {
    permissions: options.permissions ?? ALL_READ,
    present: options.present ?? EVERY_OWNER,
  });
  await screen.findByRole('heading', { name: en('links.group.order') });
}

const group = (kind: 'order' | 'quote_request' | 'opportunity'): HTMLElement =>
  screen.getByRole('heading', { name: en(`links.group.${kind}`) }).closest('section') as HTMLElement;

describe('Linked records', () => {
  it('lists the records by kind — number as a link, status and amount — and an unreadable one as unavailable', async () => {
    await renderTab();
    const orders = group('order');
    expect(within(orders).getByRole('link', { name: 'ORD-1001' })).toHaveAttribute('href', `/orders/${ORDER_ID}`);
    expect(within(orders).getByText('new')).toBeInTheDocument();
    expect(within(orders).getByText(/321/)).toBeInTheDocument();

    const quotes = group('quote_request');
    expect(within(quotes).getByText(en('links.unavailable'))).toBeInTheDocument();
    expect(within(quotes).queryByRole('link')).toBeNull();

    expect(within(group('opportunity')).getByRole('link', { name: 'OPP-000007' })).toBeInTheDocument();
  });

  it('marks a Quote Request whose lines are not all agreed beside its amount (issue #456)', async () => {
    const quote = (n: number, amount: string, partiallyAgreed: boolean): ProjectLink =>
      link({
        id: `00000000-0000-4000-8000-0000000001b${n}`,
        kind: 'quote_request',
        recordId: `00000000-0000-4000-8000-0000000000d${n}`,
        available: true,
        number: `QR-${n}`,
        status: 'Pending',
        amount,
        currency: 'PLN',
        partiallyAgreed,
        href: `/quote-requests/00000000-0000-4000-8000-0000000000d${n}`,
      });
    links = [quote(1, '35.00', true), quote(2, '33.50', false)];
    await renderTab();
    const quotes = group('quote_request');
    const row = (number: string) => within(quotes).getByRole('link', { name: number }).closest('li')!;
    expect(within(row('QR-1')).getByText(/35/)).toBeInTheDocument();
    expect(within(row('QR-1')).getByText(en('links.partiallyAgreed'))).toBeInTheDocument();
    expect(within(row('QR-2')).queryByText(en('links.partiallyAgreed'))).toBeNull();
    expect(en('links.partiallyAgreed')).toBe('Partially agreed');
  });

  it('offers records of the Project’s Organization only, and links the one chosen', async () => {
    postSpy.mockImplementation(() => {
      links = [...links, link({ id: '00000000-0000-4000-8000-0000000001a4', kind: 'order', recordId: FREE_ORDER_ID, available: true, number: 'ORD-1002' })];
      return Promise.resolve({ data: links.at(-1) });
    });
    await renderTab();
    const orders = group('order');
    await userEvent.click(within(orders).getByLabelText(en('links.add.record.order')));
    await userEvent.click(await screen.findByRole('option', { name: /ORD-1002/ }));
    const ordersQuery = getSpy.mock.calls.map(([path]) => path as string).find((path) => path.startsWith('/api/v1/admin/orders?'))!;
    expect(new URLSearchParams(ordersQuery.split('?')[1]).get('organizationId')).toBe(ORGANIZATION_ID);
    await userEvent.click(within(orders).getByRole('button', { name: en('links.add.submit.order') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(LINKS_PATH, { kind: 'order', recordId: FREE_ORDER_ID }));
    expect(await within(group('order')).findByText('ORD-1002')).toBeInTheDocument();
  });

  it('with two Organizations, asks which one first — offering the Project’s and no other', async () => {
    await renderTab({
      project: project({
        organizations: [
          { id: ORGANIZATION_ID, name: 'Acme' },
          { id: SECOND_ORG, name: 'Beta' },
        ],
      }),
    });
    const select = within(group('order')).getByLabelText(en('links.add.organization'));
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Acme', 'Beta']);
    await userEvent.selectOptions(select, SECOND_ORG);
    await userEvent.click(within(group('order')).getByLabelText(en('links.add.record.order')));
    await waitFor(() =>
      expect(
        getSpy.mock.calls
          .map(([path]) => path as string)
          .some((path) => path.startsWith('/api/v1/admin/orders?') && path.includes(`organizationId=${SECOND_ORG}`)),
      ).toBe(true),
    );
  });

  it('says which Project already holds a record, when the server names it', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'PROJECT_RECORD_ALREADY_LINKED',
          message: 'This record already belongs to a project.',
          details: { project: { id: '00000000-0000-4000-8000-0000000000f9', number: 'PRJ-000009', title: 'Other hall' } },
        },
      }),
    );
    await renderTab();
    const orders = group('order');
    await userEvent.click(within(orders).getByLabelText(en('links.add.record.order')));
    await userEvent.click(await screen.findByRole('option', { name: /ORD-1002/ }));
    await userEvent.click(within(orders).getByRole('button', { name: en('links.add.submit.order') }));
    expect(await within(orders).findByText(en('links.add.heldBy', { number: 'PRJ-000009', title: 'Other hall' }))).toBeInTheDocument();
  });

  it('unlinks a record, an unavailable one included', async () => {
    deleteSpy.mockImplementation(() => {
      links = links.filter((l) => l.kind !== 'quote_request');
      return Promise.resolve(undefined);
    });
    await renderTab();
    await userEvent.click(within(group('quote_request')).getByRole('button', { name: en('links.removeUnavailable') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${LINKS_PATH}/00000000-0000-4000-8000-0000000001a2`));
    await waitFor(() => expect(within(group('quote_request')).queryByText(en('links.unavailable'))).toBeNull());
  });

  it('a switched-off module’s group keeps its links and offers no picker, and says why', async () => {
    await renderTab({ present: ['projects', 'orders', 'crm'] });
    const quotes = group('quote_request');
    expect(within(quotes).getByText(en('links.ownerOff.quote_request'))).toBeInTheDocument();
    expect(within(quotes).getByText(en('links.unavailable'))).toBeInTheDocument();
    expect(within(quotes).queryByLabelText(en('links.add.record.quote_request'))).toBeNull();
    // The others are untouched.
    expect(within(group('order')).getByLabelText(en('links.add.record.order'))).toBeInTheDocument();
  });

  it('offers a kind’s picker only to somebody who may read records of that kind', async () => {
    await renderTab({ permissions: ['projects:read', 'projects:write', 'orders:read'] });
    expect(within(group('order')).getByLabelText(en('links.add.record.order'))).toBeInTheDocument();
    expect(within(group('quote_request')).queryByLabelText(en('links.add.record.quote_request'))).toBeNull();
    expect(within(group('opportunity')).queryByLabelText(en('links.add.record.opportunity'))).toBeNull();
  });

  it('a reader sees the links and nothing to change', async () => {
    await renderTab({ project: project({ permissions: { canWrite: false, canConfigure: false } }) });
    expect(within(group('order')).getByRole('link', { name: 'ORD-1001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unlink/ })).toBeNull();
    expect(screen.queryByLabelText(en('links.add.record.order'))).toBeNull();
  });

  it('an internal Project says that nothing can be linked to it', async () => {
    links = [];
    await renderTab({ project: project({ organizations: [] }) });
    expect(screen.getByText(en('links.internal'))).toBeInTheDocument();
    expect(screen.queryByLabelText(en('links.add.record.order'))).toBeNull();
  });
});
