import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 161, G13 (`specs/161-price-book-editor/contracts/backend-gaps.md`) —
 * the audit-log viewer keeps its object type, object id and action filters in
 * the URL, so a price book's *History* link
 * (`/audit-log?objectType=price_list&objectId=<id>`) opens the viewer already
 * filtered to that book, and changing a filter writes the URL back (a reload or
 * a shared link shows the same view). Owned by `audit_logs`.
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

const BOOK_ID = '00000000-0000-4000-8000-000000161d04';

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

async function mount(url: string): Promise<void> {
  const { default: AuditLogViewer } = await import('../../../../packages/modules/audit_logs/src/admin/pages/AuditLogViewer');
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/audit-log"
            element={
              <>
                <AuditLogViewer />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['audit_logs'] }) },
    ),
    passthroughBundle('core', ['auditLog.filter.action', 'auditLog.filter.objectType', 'auditLog.filter.objectId']),
  );
}

const auditCalls = (): string[] => get.mock.calls.map((c) => c[0]).filter((u) => u.startsWith('/api/v1/admin/audit-log'));

describe('audit-log viewer — filters in the URL (161 G13)', () => {
  beforeEach(() => {
    get.mockClear();
  });

  it('opens filtered by the object type, object id and action in the query', async () => {
    await mount(`/audit-log?objectType=price_list&objectId=${BOOK_ID}&action=price_list.rows_replace`);
    await waitFor(() => expect(auditCalls().length).toBeGreaterThan(0));
    const first = new URL(auditCalls()[0]!, 'http://x');
    expect(first.searchParams.get('filter[objectType]')).toBe('price_list');
    expect(first.searchParams.get('filter[objectId]')).toBe(BOOK_ID);
    expect(first.searchParams.get('filter[action]')).toBe('price_list.rows_replace');
    expect(auditCalls().every((u) => new URL(u, 'http://x').searchParams.get('filter[objectId]') === BOOK_ID)).toBe(true);
    expect((screen.getByLabelText('auditLog.filter.objectType') as HTMLInputElement).value).toBe('price_list');
    expect((screen.getByLabelText('auditLog.filter.objectId') as HTMLInputElement).value).toBe(BOOK_ID);
  });

  it('writes a changed filter back to the URL, and drops a cleared one', async () => {
    await mount('/audit-log?objectType=price_list');
    await waitFor(() => expect(auditCalls().length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('auditLog.filter.objectId'), { target: { value: BOOK_ID } });
    await waitFor(() => {
      const search = new URLSearchParams(screen.getByTestId('location').textContent!.split('?')[1] ?? '');
      expect(search.get('objectType')).toBe('price_list');
      expect(search.get('objectId')).toBe(BOOK_ID);
    });
    fireEvent.change(screen.getByLabelText('auditLog.filter.objectType'), { target: { value: '' } });
    await waitFor(() => {
      const search = new URLSearchParams(screen.getByTestId('location').textContent!.split('?')[1] ?? '');
      expect(search.has('objectType')).toBe(false);
      expect(search.get('objectId')).toBe(BOOK_ID);
    });
    const last = new URL(auditCalls().at(-1)!, 'http://x');
    expect(last.searchParams.get('filter[objectType]')).toBeNull();
    expect(last.searchParams.get('filter[objectId]')).toBe(BOOK_ID);
  });

  it('asks without filters when the URL names none', async () => {
    await mount('/audit-log');
    await waitFor(() => expect(auditCalls().length).toBeGreaterThan(0));
    expect(auditCalls()[0]).toBe('/api/v1/admin/audit-log');
    expect(screen.getByTestId('location').textContent).toBe('/audit-log');
  });
});
