import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AdminRelatedPayerRequest } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * `specs/182-related-payers/` T077 (FR-023, FR-024, FR-101) — the operator queue of payer requests
 * at `/related-payers/requests`: the module's landing route and sidebar entry behind
 * `related_payers:read`, rows with the reason each waits (labelled from the module's own map),
 * approve and reject-with-reason only for `related_payers:manage`, and no string that is not a
 * translation key.
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

const calls: Array<{ method: string; url: string; body?: unknown }> = [];
let permissions = new Set<string>();
let rows: AdminRelatedPayerRequest[] = [QUEUED];
const CHANNEL = { id: '00000000-0000-4000-8000-0000000000e1', code: 'pl_b2b' };

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    useAuth: () => ({ hasPermission: (code: string) => permissions.has(code) }),
    apiClient: {
      ...actual.apiClient,
      get: async (url: string) => {
        calls.push({ method: 'GET', url });
        if (url.includes('sales-channel-options')) return { data: [CHANNEL] };
        return { data: rows };
      },
      post: async (url: string, body?: unknown) => {
        calls.push({ method: 'POST', url, body });
        return { data: { id: QUEUED.id, state: 'active' } };
      },
    },
  };
});

const { RequestsQueue } = await import('../../../../packages/modules/related_payers/src/admin/pages/RequestsQueue');
const { contributions } = await import('../../../../packages/modules/related_payers/src/admin/index');
const { manifest } = await import('../../../../packages/modules/related_payers/src/manifest');

describe('RequestsQueue (T077)', () => {
  beforeEach(() => {
    calls.length = 0;
    permissions = new Set(['related_payers:read']);
    rows = [QUEUED];
  });

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

  it('lists what waits, with the reason labelled from the module\'s map, and offers no decision to a reader', async () => {
    renderWithI18n(<RequestsQueue />);
    const row = await screen.findByRole('row', { name: /Buyer X/ });
    expect(within(row).getByText('Payer Y')).toBeTruthy();
    expect(within(row).getByText('PL1234567890')).toBeTruthy();
    expect(within(row).getByText('contact@example.com')).toBeTruthy();
    expect(within(row).getByText('related_payers.enums.operatorReason.approval_mode_admin')).toBeTruthy();
    expect(calls).toEqual([{ method: 'GET', url: '/api/v1/admin/related-payers/requests?state=pending' }]);
    expect(within(row).queryByRole('button', { name: 'related_payers.queue.actions.approve' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'related_payers.queue.actions.reject' })).toBeNull();
  });

  it('with related_payers:manage, approves, and rejects only with a reason', async () => {
    permissions.add('related_payers:manage');
    renderWithI18n(<RequestsQueue />);
    const row = await screen.findByRole('row', { name: /Buyer X/ });
    fireEvent.click(within(row).getByRole('button', { name: 'related_payers.queue.actions.approve' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'POST', url: `/api/v1/admin/related-payers/requests/${QUEUED.id}/approve`, body: undefined }),
    );

    fireEvent.click(within(await screen.findByRole('row', { name: /Buyer X/ })).getByRole('button', { name: 'related_payers.queue.actions.reject' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'related_payers.queue.reject.confirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('related_payers.queue.reject.reason'), { target: { value: 'Unknown partner' } });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        url: `/api/v1/admin/related-payers/requests/${QUEUED.id}/reject`,
        body: { reason: 'Unknown partner' },
      }),
    );
  });

  it('filters by state and reason through the API', async () => {
    renderWithI18n(<RequestsQueue />);
    await screen.findByRole('row', { name: /Buyer X/ });
    fireEvent.change(screen.getByLabelText('related_payers.queue.filters.reason'), { target: { value: 'second_step' } });
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({ method: 'GET', url: '/api/v1/admin/related-payers/requests?state=pending&reason=second_step' }),
    );
  });

  it('writes no English: every rendered word is a key or data', async () => {
    permissions.add('related_payers:manage');
    const { container } = renderWithI18n(<RequestsQueue />);
    await screen.findByRole('row', { name: /Buyer X/ });
    const text = container.textContent ?? '';
    for (const word of ['Approve', 'Reject', 'Why it waits', 'Requests', 'Pending', 'Sender', 'Payer request', 'Any reason']) {
      expect(text.includes(word), word).toBe(false);
    }
  });

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

  it('a request with no Organization: no approve; send an invitation, or create the Organization pre-filled with its tax ID', async () => {
    permissions.add('related_payers:manage');
    rows = [NO_ACCOUNT];
    renderWithI18n(<RequestsQueue />);
    const row = await screen.findByRole('row', { name: /Buyer N/ });
    expect((within(row).getByRole('button', { name: 'related_payers.queue.actions.approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(row).queryByRole('button', { name: 'related_payers.queue.actions.assign' })).toBeNull();

    fireEvent.click(within(row).getByRole('button', { name: 'related_payers.queue.actions.sendInvitation' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'POST', url: `/api/v1/admin/related-payers/requests/${NO_ACCOUNT.id}/send-invitation`, body: undefined }),
    );

    fireEvent.click(within(await screen.findByRole('row', { name: /Buyer N/ })).getByRole('button', { name: 'related_payers.queue.actions.createOrganization' }));
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
    await waitFor(() => expect((within(dialog).getByLabelText('related_payers.panel.field.salesChannel') as HTMLSelectElement).value).toBe(CHANNEL.id));
    fireEvent.click(within(dialog).getByRole('button', { name: 'related_payers.queue.create.confirm' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        url: `/api/v1/admin/related-payers/requests/${NO_ACCOUNT.id}/create-organization`,
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
  });

  it('an ambiguous tax ID: assign one of its candidates', async () => {
    permissions.add('related_payers:manage');
    rows = [AMBIGUOUS];
    renderWithI18n(<RequestsQueue />);
    const row = await screen.findByRole('row', { name: /Buyer A/ });
    fireEvent.click(within(row).getByRole('button', { name: 'related_payers.queue.actions.assign' }));
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
        url: `/api/v1/admin/related-payers/requests/${AMBIGUOUS.id}/assign-organization`,
        body: { organizationId: '00000000-0000-4000-8000-0000000000c2' },
      }),
    );
  });

  it('a reader sees the unresolved request and no action on it', async () => {
    rows = [AMBIGUOUS];
    renderWithI18n(<RequestsQueue />);
    const row = await screen.findByRole('row', { name: /Buyer A/ });
    for (const action of ['assign', 'sendInvitation', 'createOrganization']) {
      expect(within(row).queryByRole('button', { name: `related_payers.queue.actions.${action}` })).toBeNull();
    }
  });
});
