import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1448 (UX audit 2026-11-17, DS-15 / SALES-24) — the invoices list said
 * "No invoices match the current filter." before anybody had filtered. "No
 * invoices yet" and "these filters match nothing" are two kit `EmptyState`
 * variants now; the second clears the filters and returns focus to the first
 * filter field.
 */

const get = vi.fn(async (_url: string) => ({ data: [] as unknown[], pagination: { cursor: null } }));

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

const { InvoicesList } = await import('../../../../packages/modules/invoices/src/admin/pages/InvoicesList');

const KEYS = [
  'invoices.fields.orderNumber',
  'invoices.fields.status',
  'invoices.empty',
  'invoices.emptyState.title',
  'invoices.emptyState.body',
  'common.emptyState.clearFilters',
];

function mount(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/invoices']}>
        <InvoicesList />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['invoices'] }) },
    ),
    passthroughBundle('core', KEYS),
  );
}

const lastCall = (): URL => new URL(get.mock.calls.map((c) => c[0]).at(-1)!, 'http://x');

describe('InvoicesList — empty states (#1448)', () => {
  beforeEach(() => {
    get.mockClear();
  });

  it('says there are no invoices yet when nothing is filtered', async () => {
    mount();
    expect(await screen.findByText('invoices.emptyState.title')).toBeTruthy();
    expect(screen.getByText('invoices.emptyState.body')).toBeTruthy();
    expect(document.querySelector('[data-empty-state]')!.getAttribute('data-empty-state')).toBe('no-data');
    expect(screen.queryByText('invoices.empty')).toBeNull();
  });

  it('tells "no match" apart from "no invoices" and clears the filters from there', async () => {
    mount();
    await screen.findByText('invoices.emptyState.title');
    await userEvent.type(screen.getByLabelText('invoices.fields.orderNumber'), 'ORD-9');
    expect(await screen.findByText('invoices.empty')).toBeTruthy();
    expect(document.querySelector('[data-empty-state]')!.getAttribute('data-empty-state')).toBe('no-results');

    await userEvent.click(screen.getByRole('button', { name: 'common.emptyState.clearFilters' }));
    expect((screen.getByLabelText('invoices.fields.orderNumber') as HTMLInputElement).value).toBe('');
    expect(await screen.findByText('invoices.emptyState.title')).toBeTruthy();
    await waitFor(() => expect(lastCall().searchParams.toString()).not.toContain('ORD-9'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('invoices.fields.orderNumber')));
  });
});
