import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #741 (`specs/170-organization-roles/` FR-065) — the actor column names
 * a customer who acted for themselves on the storefront, as `Customer: <label>`,
 * where it used to read "system": the row has no admin id, and the viewer knew
 * no other actor. An admin row, an impersonation row and a system row keep
 * their own rendering, so the three are told apart at a glance.
 */

const get = vi.fn(async (_url: string) => ({ data: ROWS as unknown[] }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => get(...(args as [string])),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const ORG_ID = '00000000-0000-4000-8000-000000000741';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-0000000000c1';
const UNLABELLED_CUSTOMER_ID = 'd0000000-0000-4000-8000-0000000000c2';

function row(id: string, actor: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    actorAdminUserId: null,
    actorName: null,
    actorEmail: null,
    actorCustomerAccountId: null,
    actorCustomerLabel: null,
    impersonatedCustomerAccountId: null,
    actedAt: '2026-11-05T10:00:00.000Z',
    action: 'organization_role.create',
    actionModuleId: 'core',
    objectType: 'organization',
    objectId: ORG_ID,
    stateBefore: null,
    stateAfter: null,
    ipAddress: null,
    userAgent: null,
    requestId: null,
    ...actor,
  };
}

const ROWS = [
  row('00000000-0000-4000-8000-000000000001', {
    actorCustomerAccountId: CUSTOMER_ID,
    actorCustomerLabel: 'Demo Buyer Org',
  }),
  row('00000000-0000-4000-8000-000000000002', { actorCustomerAccountId: UNLABELLED_CUSTOMER_ID }),
  row('00000000-0000-4000-8000-000000000003', {
    actorAdminUserId: ADMIN_ID,
    actorName: 'Anna Admin',
    actorEmail: 'anna@example.com',
  }),
  row('00000000-0000-4000-8000-000000000004', {}),
];

async function mount(): Promise<void> {
  const { default: AuditLogViewer } = await import('../../../../packages/modules/audit_logs/src/admin/pages/AuditLogViewer');
  const bundle = passthroughBundle('core', ['auditLog.actor.system', 'auditLog.column.actor']);
  bundle['core'] = { ...bundle['core'], 'auditLog.actor.customer': 'Customer: {name}' };
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/audit-log?objectType=organization&objectId=${ORG_ID}`]}>
        <Routes>
          <Route path="/audit-log" element={<AuditLogViewer />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['audit_logs'] }) },
    ),
    bundle,
  );
}

function actorCellOf(rowIndex: number): HTMLElement {
  // Row 0 is the header; the actor is the second column.
  const rows = screen.getAllByRole('row');
  return within(rows[rowIndex + 1]!).getAllByRole('cell')[1]!;
}

describe('audit-log viewer — the actor column (issue #741)', () => {
  beforeEach(() => {
    get.mockClear();
  });

  it('names a customer who acted for themselves, not "system"', async () => {
    await mount();
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1));
    const cell = actorCellOf(0);
    expect(cell).toHaveTextContent('Customer: Demo Buyer Org');
    expect(cell).not.toHaveTextContent('auditLog.actor.system');
    expect(cell.querySelector('[title]')?.getAttribute('title')).toBe(CUSTOMER_ID);
  });

  it('falls back to the short account id when the customer has no label', async () => {
    await mount();
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1));
    expect(actorCellOf(1)).toHaveTextContent(`Customer: ${UNLABELLED_CUSTOMER_ID.slice(0, 8)}`);
  });

  it('keeps the admin and the system rows as they were', async () => {
    await mount();
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1));
    expect(actorCellOf(2)).toHaveTextContent('Anna Admin (anna@example.com)');
    expect(actorCellOf(2)).not.toHaveTextContent('Customer:');
    expect(actorCellOf(3)).toHaveTextContent('auditLog.actor.system');
  });
});
