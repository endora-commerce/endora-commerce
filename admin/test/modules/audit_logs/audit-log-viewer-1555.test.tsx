import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import en from '../../../../packages/modules/audit_logs/i18n/en.json';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1555 (UX audit 2026-11-17, SHELL-20) — the audit log asked for
 * `product.update`-style codes it could offer, drew two raw JSON blocks for a
 * change, and showed only the first page. Now its filters offer what the log
 * holds under the labels the table uses, a row's detail is the change field by
 * field, and the kit pager walks the cursor the list answers.
 */

const CORE = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const CATALOG = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/catalog/i18n/en.json'), 'utf8'),
) as Record<string, string>;

const ENTRY = {
  id: '00000000-0000-4000-8000-000000001555',
  actorAdminUserId: null,
  actorName: null,
  actorEmail: null,
  impersonatedCustomerAccountId: null,
  actedAt: '2026-11-20T10:00:00.000Z',
  action: 'product.update',
  actionModuleId: 'catalog',
  objectType: 'product',
  objectId: '00000000-0000-4000-8000-0000000000p1',
  stateBefore: { status: 'draft', isActive: false, sku: 'A-1', version: 3 },
  stateAfter: { status: 'active', isActive: true, sku: 'A-1', version: 4, changedFields: ['status', 'isActive'] },
  ipAddress: null,
  userAgent: null,
  requestId: 'req-1',
};

const pages: Record<string, { data: unknown[]; pagination: { cursor: string | null; hasMore: boolean; limit: number } }> = {
  first: { data: [ENTRY], pagination: { cursor: 'c-2', hasMore: true, limit: 25 } },
  second: { data: [{ ...ENTRY, id: '00000000-0000-4000-8000-000000002555' }], pagination: { cursor: null, hasMore: false, limit: 25 } },
};

const get = vi.fn(async (url: string) => {
  if (url.startsWith('/api/v1/admin/audit-log/facets')) {
    return {
      data: {
        actions: [
          { action: 'product.update', moduleId: 'catalog' },
          { action: 'impersonation.start', moduleId: 'core' },
        ],
        objectTypes: ['product', 'setting'],
      },
    };
  }
  if (url.startsWith('/api/v1/admin/audit-log')) {
    return new URL(url, 'http://x').searchParams.get('cursor') === 'c-2' ? pages.second : pages.first;
  }
  return { data: [] };
});

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

async function mount(): Promise<void> {
  const { default: AuditLogViewer } = await import('../../../../packages/modules/audit_logs/src/admin/pages/AuditLogViewer');
  const bundle: Bundle = { core: CORE, catalog: CATALOG, audit_logs: en as Record<string, string> };
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/audit-log']}>
        <Routes>
          <Route path="/audit-log" element={<AuditLogViewer />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['audit_logs'] }) },
    ),
    bundle,
  );
  await screen.findByRole('table');
}

const listCalls = (): URL[] =>
  get.mock.calls.map((c) => c[0]).filter((u) => u.startsWith('/api/v1/admin/audit-log?')).map((u) => new URL(u, 'http://x'));

describe('audit-log viewer (issue #1555)', () => {
  beforeEach(() => {
    get.mockClear();
  });

  it('offers the logged actions under their labels, and filters by the chosen code', async () => {
    await mount();
    const action = screen.getByRole('combobox', { name: CORE['auditLog.filter.action']! });
    expect(action).toHaveAttribute('placeholder', en['auditLog.filter.anyAction']);
    await userEvent.click(action);
    const listbox = await screen.findByRole('listbox');
    const label = CATALOG['auditLog.product.update']!;
    expect(within(listbox).getByRole('option', { name: new RegExp(label) })).toHaveTextContent('product.update');
    await userEvent.click(within(listbox).getByRole('option', { name: new RegExp(label) }));
    await waitFor(() => expect(listCalls().at(-1)!.searchParams.get('filter[action]')).toBe('product.update'));
  });

  it('offers the logged object types', async () => {
    await mount();
    await userEvent.click(screen.getByRole('combobox', { name: CORE['auditLog.filter.objectType']! }));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['product', 'setting']);
  });

  it('has no Apply button and no free-text code fields left', async () => {
    await mount();
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
    expect(screen.queryByPlaceholderText('product.update')).toBeNull();
    expect(screen.queryByPlaceholderText('UUID')).toBeNull();
  });

  it('draws a change field by field, before → after, with the stored JSON folded away', async () => {
    await mount();
    const toggle = screen.getByRole('button', { name: CORE['auditLog.action.detail']! });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    const status = within(detail).getByText('status', { selector: 'code' }).closest('dt')!.nextElementSibling!;
    expect(status).toHaveTextContent(`${CORE['history.status.from']}draft${CORE['history.status.to']}active`);
    const active = within(detail).getByText('isActive', { selector: 'code' }).closest('dt')!.nextElementSibling!;
    expect(active).toHaveTextContent(`${en['auditLog.value.false']}`);
    expect(active).toHaveTextContent(`${en['auditLog.value.true']}`);
    const changed = within(detail).getByText(en['auditLog.field.changedFields']).nextElementSibling!;
    expect(changed).toHaveTextContent('status, isActive');
    // The unchanged field is not a row.
    expect(within(detail).queryByText('sku', { selector: 'code' })).toBeNull();
    const raw = within(detail).getByText(en['auditLog.diff.raw']).closest('details')!;
    expect(raw).not.toHaveAttribute('open');
    expect(raw.querySelectorAll('pre')).toHaveLength(2);
  });

  it('pages on with the cursor the list answered', async () => {
    await mount();
    expect(listCalls()[0]!.searchParams.get('cursor')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: new RegExp(CORE['common.pagination.next']!) }));
    await waitFor(() => expect(listCalls().at(-1)!.searchParams.get('cursor')).toBe('c-2'));
  });
});
