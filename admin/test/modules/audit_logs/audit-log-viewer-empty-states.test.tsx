import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1448 (UX audit 2026-11-17, DS-15 / SHELL-20) — the audit-log viewer
 * said "No entries match the current filter." on a log nobody had filtered.
 * "Nothing recorded yet" and "these filters match nothing" are now two kit
 * `EmptyState` variants, and the second clears every filter, the URL ones
 * included, and returns focus to the first filter field.
 */

const get = vi.fn(async (_url: string) => ({ data: [] as unknown[] }));

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

const KEYS = [
  'auditLog.filter.action',
  'auditLog.filter.objectType',
  'auditLog.empty',
  'auditLog.emptyState.title',
  'auditLog.emptyState.body',
  'common.emptyState.clearFilters',
];

async function mount(url: string): Promise<void> {
  const { default: AuditLogViewer } = await import('../../../../packages/modules/audit_logs/src/admin/pages/AuditLogViewer');
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/audit-log" element={<AuditLogViewer />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['audit_logs'] }) },
    ),
    passthroughBundle('core', KEYS),
  );
}

const lastAuditCall = (): URL =>
  new URL(get.mock.calls.map((c) => c[0]).filter((u) => u.startsWith('/api/v1/admin/audit-log?')).at(-1)!, 'http://x');

describe('audit-log viewer — empty states (#1448)', () => {
  beforeEach(() => {
    get.mockClear();
  });

  it('says nothing is recorded yet on an unfiltered empty log, with no Clear filters', async () => {
    await mount('/audit-log');
    expect(await screen.findByText('auditLog.emptyState.title')).toBeTruthy();
    expect(screen.getByText('auditLog.emptyState.body')).toBeTruthy();
    expect(document.querySelector('[data-empty-state]')!.getAttribute('data-empty-state')).toBe('no-data');
    expect(screen.queryByText('auditLog.empty')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common.emptyState.clearFilters' })).toBeNull();
  });

  it('tells a filtered empty log apart, and clears every filter from there', async () => {
    await mount('/audit-log?objectType=price_list');
    expect(await screen.findByText('auditLog.empty')).toBeTruthy();
    expect(document.querySelector('[data-empty-state]')!.getAttribute('data-empty-state')).toBe('no-results');
    expect(screen.queryByText('auditLog.emptyState.title')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'common.emptyState.clearFilters' }));
    await waitFor(() => expect(lastAuditCall().searchParams.get('filter[objectType]')).toBeNull());
    expect((screen.getByLabelText('auditLog.filter.objectType') as HTMLInputElement).value).toBe('');
    expect(await screen.findByText('auditLog.emptyState.title')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('auditLog.filter.action')));
  });
});
