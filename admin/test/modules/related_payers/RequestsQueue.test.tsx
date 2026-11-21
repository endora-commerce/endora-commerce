import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AdminRelatedPayerRequest } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * `specs/182-related-payers/` T077 (FR-023, FR-024, FR-101) — the operator queue of payer requests
 * at `/related-payers/requests`: the module's landing route and sidebar entry behind
 * `related_payers:read`, rows with the reason each waits (labelled from the module's own map),
 * the decisions only for `related_payers:manage`, and no string that is not a translation key.
 *
 * UX audit 2026-11-17 (DS-05 #1439, DS-06 #1440, DS-07 #1441, DS-15 #1448, SHELL-18 #1502): the
 * queue is the kit `ListPage`, server-paged; its two filters are a `ListToolbar`; a row's Approve
 * is an outline button and every other decision is in the row's menu, Reject last; an empty queue
 * and a filtered-out one are two different `EmptyState`s.
 */

const QUEUED: AdminRelatedPayerRequest = {
  id: '00000000-0000-4000-8000-0000000000d1',
  direction: 'buyer_request',
  taxId: 'PL1234567890',
  contactEmail: 'contact@example.com',
  comment: 'Tender 2026/14',
  state: 'pending',
  rejectionReason: null,
  createdAt: '2026-11-19T09:00:00.000Z',
  decidedAt: null,
  expiresAt: '2026-12-19T09:00:00.000Z',
  senderOrganizationId: '00000000-0000-4000-8000-0000000000b1',
  senderName: 'Buyer X',
  counterpartyOrganizationId: '00000000-0000-4000-8000-0000000000b2',
  counterpartyName: 'Payer Y',
  routing: 'operator',
  operatorReason: 'approval_mode_admin',
  approvalMode: 'admin',
  unregisteredMode: 'admin',
  salesChannelId: '00000000-0000-4000-8000-0000000000e1',
  counterpartyAcceptedAt: null,
  candidates: [],
};

/** Phase 6 (T090, FR-023) — a request whose Organization is not settled. */
const NO_ACCOUNT: AdminRelatedPayerRequest = {
  ...QUEUED,
  id: '00000000-0000-4000-8000-0000000000d2',
  senderName: 'Buyer N',
  taxId: 'PL5550001111',
  counterpartyOrganizationId: null,
  counterpartyName: null,
  operatorReason: 'no_account',
};
const AMBIGUOUS: AdminRelatedPayerRequest = {
  ...NO_ACCOUNT,
  id: '00000000-0000-4000-8000-0000000000d3',
  senderName: 'Buyer A',
  operatorReason: 'ambiguous_tax_id',
  candidates: [
    { organizationId: '00000000-0000-4000-8000-0000000000c1', name: 'Twin One' },
    { organizationId: '00000000-0000-4000-8000-0000000000c2', name: 'Twin Two' },
  ],
};

const QUEUE = '/api/v1/admin/related-payers/requests';
const CHANNEL = { id: '00000000-0000-4000-8000-0000000000e1', code: 'pl_b2b' };
const state = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; url: string; body?: unknown }>,
  rows: [] as unknown[],
  total: null as number | null,
  failPost: null as string | null,
  failNextGet: false,
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const refuse = (status: number, code: string, message: string) => new actual.ApiError(status, { error: { code, message } } as never);
  return {
    ...actual,
    apiClient: {
      get: async (url: string) => {
        state.calls.push({ method: 'GET', url });
        if (url.includes('sales-channel-options')) return { data: [CHANNEL] };
        if (state.failNextGet) {
          state.failNextGet = false;
          throw refuse(500, 'INTERNAL', 'Down.');
        }
        const query = new URLSearchParams(url.split('?')[1] ?? '');
        return {
          data: state.rows,
          meta: {
            page: Number(query.get('page') ?? 1),
            pageSize: Number(query.get('pageSize') ?? 500),
            total: state.total ?? state.rows.length,
          },
        };
      },
      post: async (url: string, body?: unknown) => {
        state.calls.push({ method: 'POST', url, body });
        if (state.failPost && url.endsWith(state.failPost)) throw refuse(409, 'RELATED_PAYER_REQUEST_DECIDED', 'Already decided.');
        return { data: { id: QUEUED.id, state: 'active' } };
      },
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { RequestsQueue } = await import('../../../../packages/modules/related_payers/src/admin/pages/RequestsQueue');
const { contributions } = await import('../../../../packages/modules/related_payers/src/admin/index');
const { manifest } = await import('../../../../packages/modules/related_payers/src/manifest');

const calls = state.calls;
const queueCalls = (): URLSearchParams[] =>
  calls.filter((c) => c.method === 'GET' && c.url.startsWith(QUEUE)).map((c) => new URLSearchParams(c.url.split('?')[1] ?? ''));

const MANAGE = ['related_payers:read', 'related_payers:manage'];

function render(permissions: readonly string[] = ['related_payers:read']) {
  return renderWithI18n(withSession(<RequestsQueue />, { session: adminSession({ permissions }) }));
}

async function openRowMenu(row: HTMLElement): Promise<HTMLElement> {
  fireEvent.pointerDown(within(row).getByRole('button', { name: 'related_payers.queue.rowMenu.label' }), { button: 0, ctrlKey: false });
  return screen.findByRole('menu');
}

describe('RequestsQueue (T077; UX audit DS-05/06/07/15)', () => {
  beforeEach(() => {
    setMobileViewport(false);
    calls.length = 0;
    state.rows = [QUEUED];
    state.total = null;
    state.failPost = null;
    state.failNextGet = false;
  });
  afterEach(() => cleanup());

  it('is the module\'s landing route and sidebar entry, behind related_payers:read, and the palette opens it', () => {
    const route = contributions.routes?.find((r) => r.path === '/related-payers/requests');
    expect(route).toMatchObject({ index: true, requiredPermission: 'related_payers:read' });
    const nav = contributions.nav?.find((n) => n.to === '/related-payers/requests');
    expect(nav).toMatchObject({ requiredPermission: 'related_payers:read', section: 'customers' });
    expect(manifest.actions).toContainEqual(
      expect.objectContaining({
        id: 'open-payer-requests',
        targetRoute: '/related-payers/requests',
        requiredPermission: 'related_payers:read',
      }),
    );
  });

  it('lists what waits, one page at a time, with the reason labelled from the module\'s map, and offers no decision to a reader', async () => {
    render();
    const row = await screen.findByRole('row', { name: /Buyer X/ });
    expect(within(row).getByText('Payer Y')).toBeTruthy();
    expect(within(row).getByText('PL1234567890')).toBeTruthy();
    expect(within(row).getByText('contact@example.com')).toBeTruthy();
    expect(within(row).getByText('related_payers.enums.operatorReason.approval_mode_admin')).toBeTruthy();
    expect(calls).toEqual([{ method: 'GET', url: `${QUEUE}?state=pending&page=1&pageSize=20` }]);
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('draws the kit pager over the total and asks for the next page', async () => {
    state.total = 45;
    render();
    await screen.findByRole('row', { name: /Buyer X/ });
    fireEvent.click(screen.getByRole('button', { name: 'core.common.pagination.next' }));
    await waitFor(() => expect(queueCalls().at(-1)!.get('page')).toBe('2'));
  });

  it('with related_payers:manage, Approve is an outline row button — never filled — and its result is said beside the list', async () => {
    render(MANAGE);
    const row = await screen.findByRole('row', { name: /Buyer X/ });
    const approve = within(row).getByRole('button', { name: 'related_payers.queue.actions.approve' });
    expect(approve.className).not.toMatch(/\bbg-primary\b/);
    expect(approve.className).toMatch(/\bborder-input\b/);
    fireEvent.click(approve);
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', url: `${QUEUE}/${QUEUED.id}/approve`, body: undefined }));
    expect((await screen.findByText('related_payers.queue.status.approved')).closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refused Approve says why beside the list, and the row stays', async () => {
    state.failPost = '/approve';
    render(MANAGE);
    fireEvent.click(
      within(await screen.findByRole('row', { name: /Buyer X/ })).getByRole('button', { name: 'related_payers.queue.actions.approve' }),
    );
    expect(await screen.findByText('Already decided.')).toBeTruthy();
    expect(screen.getByRole('row', { name: /Buyer X/ })).toBeTruthy();
  });

  it('rejects from the row menu — the last entry — and only with a reason', async () => {
    render(MANAGE);
    const menu = await openRowMenu(await screen.findByRole('row', { name: /Buyer X/ }));
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['related_payers.queue.actions.reject']);
    fireEvent.click(items[0]!);
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'related_payers.queue.reject.confirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('related_payers.queue.reject.reason'), { target: { value: 'Unknown partner' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'POST', url: `${QUEUE}/${QUEUED.id}/reject`, body: { reason: 'Unknown partner' } }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('related_payers.queue.status.rejected')).toBeTruthy();
  });

  it('a refused Reject keeps the dialog open with the server\'s message in it', async () => {
    state.failPost = '/reject';
    render(MANAGE);
    fireEvent.click(within(await openRowMenu(await screen.findByRole('row', { name: /Buyer X/ }))).getByRole('menuitem'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('related_payers.queue.reject.reason'), { target: { value: 'No' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'related_payers.queue.reject.confirm' }));
    expect(await within(dialog).findByText('Already decided.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('filters by state and reason in a labelled toolbar, back to the first page, and Clear all filters restores the queue', async () => {
    state.total = 45;
    render();
    await screen.findByRole('row', { name: /Buyer X/ });
    const toolbar = screen.getByRole('search', { name: 'related_payers.queue.toolbar.label' });
    fireEvent.click(screen.getByRole('button', { name: 'core.common.pagination.next' }));
    await waitFor(() => expect(queueCalls().at(-1)!.get('page')).toBe('2'));

    expect(within(toolbar).queryByRole('button', { name: 'core.common.listToolbar.clearAll' })).toBeNull();
    fireEvent.change(within(toolbar).getByRole('combobox', { name: 'related_payers.queue.filters.reason' }), {
      target: { value: 'second_step' },
    });
    await waitFor(() => {
      const last = queueCalls().at(-1)!;
      expect([last.get('state'), last.get('reason'), last.get('page')]).toEqual(['pending', 'second_step', '1']);
    });
    fireEvent.change(within(toolbar).getByRole('combobox', { name: 'related_payers.queue.filters.state' }), {
      target: { value: 'rejected' },
    });
    await waitFor(() => expect(queueCalls().at(-1)!.get('state')).toBe('rejected'));

    fireEvent.click(within(toolbar).getByRole('button', { name: 'core.common.listToolbar.clearAll' }));
    await waitFor(() => {
      const last = queueCalls().at(-1)!;
      expect([last.get('state'), last.get('reason')]).toEqual(['pending', null]);
    });
  });

  it('an empty queue is the no-data empty state; a filtered-out one offers Clear filters', async () => {
    state.rows = [];
    render();
    const empty = await screen.findByText('related_payers.queue.empty.title');
    expect(empty.closest('[data-empty-state]')?.getAttribute('data-empty-state')).toBe('no-data');
    expect(screen.queryByRole('row')).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'related_payers.queue.filters.reason' }), { target: { value: 'no_account' } });
    const filtered = await screen.findByText('related_payers.queue.emptyFiltered');
    expect(filtered.closest('[data-empty-state]')?.getAttribute('data-empty-state')).toBe('no-results');
    fireEvent.click(screen.getByRole('button', { name: 'core.common.emptyState.clearFilters' }));
    await waitFor(() => expect(queueCalls().at(-1)!.get('reason')).toBeNull());
    expect(await screen.findByText('related_payers.queue.empty.title')).toBeTruthy();
  });

  it('a failed read says so, with Retry', async () => {
    state.failNextGet = true;
    render();
    expect(await screen.findByText('Down.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'core.common.action.retry' }));
    expect(await screen.findByRole('row', { name: /Buyer X/ })).toBeTruthy();
  });

  it('writes no English: every rendered word is a key or data', async () => {
    state.rows = [QUEUED, NO_ACCOUNT];
    const { container } = render(MANAGE);
    await screen.findByRole('row', { name: /Buyer X/ });
    const text = container.textContent ?? '';
    for (const word of ['Approve', 'Reject', 'Why it waits', 'Requests', 'Pending', 'Sender', 'Payer request', 'Any reason']) {
      expect(text.includes(word), word).toBe(false);
    }
  });

  it('a request with no Organization: no Approve; its menu sends an invitation, or creates the Organization pre-filled with its tax ID', async () => {
    state.rows = [NO_ACCOUNT];
    render(MANAGE);
    const row = await screen.findByRole('row', { name: /Buyer N/ });
    expect(within(row).queryByRole('button', { name: 'related_payers.queue.actions.approve' })).toBeNull();
    let menu = await openRowMenu(row);
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'related_payers.queue.actions.createOrganization',
      'related_payers.queue.actions.sendInvitation',
      'related_payers.queue.actions.reject',
    ]);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'related_payers.queue.actions.sendInvitation' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'POST', url: `${QUEUE}/${NO_ACCOUNT.id}/send-invitation`, body: undefined }),
    );
    expect(await screen.findByText('related_payers.queue.status.invited')).toBeTruthy();

    menu = await openRowMenu(await screen.findByRole('row', { name: /Buyer N/ }));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'related_payers.queue.actions.createOrganization' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('related_payers.panel.field.taxId') as HTMLInputElement).value).toBe('PL5550001111');
    for (const [label, value] of [
      ['related_payers.panel.field.name', 'Investor SA'],
      ['related_payers.panel.field.street', 'Prosta 1'],
      ['related_payers.panel.field.city', 'Warszawa'],
      ['related_payers.panel.field.postalCode', '00-001'],
    ] as const) {
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    }
    await waitFor(() =>
      expect((within(dialog).getByLabelText('related_payers.panel.field.salesChannel') as HTMLSelectElement).value).toBe(CHANNEL.id),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'related_payers.queue.create.confirm' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        url: `${QUEUE}/${NO_ACCOUNT.id}/create-organization`,
        body: {
          organization: {
            name: 'Investor SA',
            taxId: 'PL5550001111',
            registeredAddress: { street: 'Prosta 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
            salesChannelIds: [CHANNEL.id],
          },
        },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('related_payers.queue.status.created')).toBeTruthy();
  });

  it('an ambiguous tax ID: assign one of its candidates from the row menu', async () => {
    state.rows = [AMBIGUOUS];
    render(MANAGE);
    const menu = await openRowMenu(await screen.findByRole('row', { name: /Buyer A/ }));
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'related_payers.queue.actions.assign',
      'related_payers.queue.actions.createOrganization',
      'related_payers.queue.actions.sendInvitation',
      'related_payers.queue.actions.reject',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'related_payers.queue.actions.assign' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'related_payers.queue.assign.confirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('related_payers.queue.assign.organization'), {
      target: { value: '00000000-0000-4000-8000-0000000000c2' },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        url: `${QUEUE}/${AMBIGUOUS.id}/assign-organization`,
        body: { organizationId: '00000000-0000-4000-8000-0000000000c2' },
      }),
    );
    expect(await screen.findByText('related_payers.queue.status.assigned')).toBeTruthy();
  });

  it('a reader sees the unresolved request and no action on it', async () => {
    state.rows = [AMBIGUOUS];
    render();
    const row = await screen.findByRole('row', { name: /Buyer A/ });
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('a decided request has no action, even for a manager', async () => {
    state.rows = [{ ...QUEUED, state: 'rejected', rejectionReason: 'No' }];
    render(MANAGE);
    const row = await screen.findByRole('row', { name: /Buyer X/ });
    expect(within(row).queryByRole('button')).toBeNull();
  });
});
