import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { CASE_180 } from './return-detail-fixture';

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03) — inside a card, a list of items is
 * rows divided by a rule, not a bordered box per item: a frame inside a card
 * reads as a separate object (Common Region). The return's comments and the
 * clauses the customer accepted were one `rounded-md border` box each.
 */

installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => api.get(...args),
      post: (...args: unknown[]) => api.post(...args),
      put: (...args: unknown[]) => api.put(...args),
      patch: (...args: unknown[]) => api.patch(...args),
      delete: (...args: unknown[]) => api.delete(...args),
    },
  };
});

const { ReturnDetail } = await import('../../../../packages/modules/returns/src/admin/pages/ReturnDetail');

const BUNDLE = passthroughBundle('returns', [
  'comments.title',
  'comments.author.admin',
  'comments.author.customer',
  'comments.internalBadge',
  'clauses.acceptedTitle',
  'clauses.revisionOf',
]);

const RC = {
  ...CASE_180,
  comments: [
    { id: 'c1', authorKind: 'admin', body: 'First note', isCustomerVisible: false, createdAt: '2026-11-02T10:00:00Z' },
    { id: 'c2', authorKind: 'customer', body: 'Second note', isCustomerVisible: true, createdAt: '2026-11-03T10:00:00Z' },
  ],
  clausesAcceptedAt: '2026-11-01T10:00:00Z',
  acceptedClauses: [
    { clauseId: 'k1', revision: 1, label: 'Terms', mode: 'required', language: 'en', text: 'Clause one', linkUrl: null },
    { clauseId: 'k2', revision: 3, label: 'Privacy', mode: 'required', language: 'en', text: 'Clause two', linkUrl: null },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: RC });
    if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: { statuses: [], transitions: [] } });
    return Promise.resolve({ data: [] });
  });
});

function renderDetail(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/returns/r1']}>
      <Routes>
        <Route path="/returns/:id" element={<ReturnDetail />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
}

function framed(element: Element): boolean {
  return /\bborder\b/.test(element.className) && /\brounded/.test(element.className);
}

describe('ReturnDetail — item lists as divided rows (DS-03)', () => {
  it('lists the comments as divided rows, not a bordered box each', async () => {
    renderDetail();
    const first = await screen.findByText('First note');
    const list = first.closest('ul');
    expect(list).not.toBeNull();
    expect(list!.className).toMatch(/\bdivide-y\b/);
    const rows = [...list!.children];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.tagName).toBe('LI');
      expect(framed(row)).toBe(false);
    }
  });

  it('lists the accepted clauses as divided disclosure rows, not a bordered box each', async () => {
    renderDetail();
    await screen.findByText('First note');
    const details = [...document.querySelectorAll('details')];
    expect(details).toHaveLength(2);
    const list = details[0]!.parentElement!;
    expect(list.className).toMatch(/\bdivide-y\b/);
    for (const item of details) expect(framed(item)).toBe(false);
  });
});

describe('ReturnDetail — the way back (#1549, SALES-27)', () => {
  it('goes back to the returns through the header back link, not a button above it', async () => {
    renderDetail();
    await screen.findByText('First note');
    const heading = screen.getByRole('heading', { level: 1 });
    const back = within(heading.closest('header')!).getByRole('link', { name: 'core.returns.title' });
    expect(back).toHaveAttribute('href', '/returns');
    expect(screen.getAllByRole('link', { name: 'core.returns.title' })).toHaveLength(1);
  });
});
