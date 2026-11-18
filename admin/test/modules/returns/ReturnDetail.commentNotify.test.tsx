import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { CASE_180 } from './return-detail-fixture';

/**
 * `specs/180-off-platform-complaints/` T029 (FR-A20, FR-A21; D-16, D-17; design
 * review R-5.8): the comment form defaults to an internal comment, has a visible
 * label, and offers *notify customer* only for a customer-visible comment.
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
  'comments.newComment',
  'comments.customerVisible',
  'comments.notifyCustomer',
  'comments.notifyRequiresVisible',
  'comments.add',
  'comments.emailRequested',
  'comments.author.admin',
  'comments.author.customer',
  'comments.internalBadge',
  'comments.none',
]);

let rc: typeof CASE_180;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  rc = { ...CASE_180, comments: [] };
  api.get.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: rc });
    if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: { statuses: [], transitions: [] } });
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValue({ data: { id: 'c1' } });
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

describe('ReturnDetail — the comment form (180 T029)', () => {
  it('labels the comment box visibly', async () => {
    renderDetail();
    const box = await screen.findByLabelText('comments.newComment');
    expect(box.tagName).toBe('TEXTAREA');
  });

  it('defaults a new comment to internal, with notify disabled, unchecked and explained (D-16)', async () => {
    renderDetail();
    const visible = await screen.findByRole('checkbox', { name: 'comments.customerVisible' });
    const notify = screen.getByRole('checkbox', { name: 'comments.notifyCustomer' });
    expect(visible).not.toBeChecked();
    expect(notify).toBeDisabled();
    expect(notify).not.toBeChecked();
    const hintId = notify.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)?.textContent).toBe('comments.notifyRequiresVisible');
  });

  it('clears notify when the comment is made internal again, and does not re-check it', async () => {
    renderDetail();
    const visible = await screen.findByRole('checkbox', { name: 'comments.customerVisible' });
    const notify = screen.getByRole('checkbox', { name: 'comments.notifyCustomer' });
    await userEvent.click(visible);
    expect(notify).toBeEnabled();
    await userEvent.click(notify);
    expect(notify).toBeChecked();
    await userEvent.click(visible);
    expect(notify).not.toBeChecked();
    expect(notify).toBeDisabled();
    await userEvent.click(visible);
    expect(notify).toBeEnabled();
    expect(notify).not.toBeChecked();
  });

  it('posts a visible comment with notify', async () => {
    renderDetail();
    await userEvent.type(await screen.findByLabelText('comments.newComment'), 'Your parcel arrived.');
    await userEvent.click(screen.getByRole('checkbox', { name: 'comments.customerVisible' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'comments.notifyCustomer' }));
    await userEvent.click(screen.getByRole('button', { name: 'comments.add' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/r1/comments', {
        body: 'Your parcel arrived.',
        isCustomerVisible: true,
        notifyCustomer: true,
      }),
    );
  });

  it('marks a comment posted with notify as "E-mail requested", and translates the author', async () => {
    rc = {
      ...CASE_180,
      comments: [
        { id: 'c1', authorKind: 'admin', body: 'Told them.', isCustomerVisible: true, notifyCustomer: true, createdAt: '2026-11-02T10:00:00Z' },
        { id: 'c2', authorKind: 'admin', body: 'Note to self.', isCustomerVisible: false, notifyCustomer: false, createdAt: '2026-11-02T11:00:00Z' },
      ],
    };
    renderDetail();
    expect(await screen.findByText('comments.emailRequested')).toBeInTheDocument();
    expect(screen.getAllByText('comments.emailRequested')).toHaveLength(1);
    expect(screen.getAllByText('comments.author.admin')).toHaveLength(2);
    expect(screen.getByText('comments.internalBadge')).toBeInTheDocument();
  });
});
