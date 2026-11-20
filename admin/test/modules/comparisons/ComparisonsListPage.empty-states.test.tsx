import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1448 (UX audit 2026-11-17, DS-15) — the comparisons list said "No
 * comparisons match the filters." on a list nobody had filtered, and had no
 * way back from filters that matched nothing. It shows the kit `EmptyState`
 * now: `no-data` when the storefront has generated none, `no-results` with
 * *Clear filters* when the filters hide them all. A server scope notice still
 * wins over both: only the server can say "none of these is yours".
 */

const listComparisons = vi.fn();

vi.mock('../../../../packages/modules/comparisons/src/admin/api/comparisons-client', () => ({
  listComparisons: (...args: unknown[]) => listComparisons(...args),
}));

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>('@endora-commerce/admin-kit/components');
  return { ...actual, SalesChannelPicker: ({ id }: { id?: string }) => <input id={id} readOnly /> };
});

const { default: ComparisonsListPage } = await import('../../../../packages/modules/comparisons/src/admin/pages/ComparisonsListPage');

const ROW = {
  id: 'cmp-1',
  owner: { kind: 'anonymous' },
  salesChannel: { id: 'ch-1', code: 'b2b' },
  displayMode: 'net',
  productCount: 2,
  createdAt: '2026-11-20T00:00:00.000Z',
};

const answer = (data: unknown[], scopeNotice?: string): void => {
  listComparisons.mockResolvedValue({ data, meta: { nextCursor: null, ...(scopeNotice ? { scopeNotice } : {}) } });
};

function mount(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <ComparisonsListPage />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['comparisons'] }) },
    ),
    {
      ...passthroughBundle('comparisons', [
        'list.filter.owner',
        'list.empty',
        'list.emptyState.title',
        'list.emptyState.body',
        'owner.any',
        'owner.customer',
      ]),
      ...passthroughBundle('core', ['common.emptyState.clearFilters']),
    },
  );
}

describe('ComparisonsListPage — empty states (#1448)', () => {
  beforeEach(() => {
    listComparisons.mockReset();
  });

  it('says no comparison has been generated yet when nothing is filtered', async () => {
    answer([]);
    mount();
    expect(await screen.findByText('list.emptyState.title')).toBeTruthy();
    expect(screen.getByText('list.emptyState.body')).toBeTruthy();
    expect(document.querySelector('[data-empty-state]')!.getAttribute('data-empty-state')).toBe('no-data');
    expect(screen.queryByText('list.empty')).toBeNull();
  });

  it('tells "no match" apart and clears the filters from there', async () => {
    answer([ROW]);
    mount();
    await screen.findByText('b2b');
    answer([]);
    const owner = screen.getByLabelText('list.filter.owner') as HTMLSelectElement;
    fireEvent.change(owner, { target: { value: 'customer' } });
    expect(await screen.findByText('list.empty')).toBeTruthy();
    expect(document.querySelector('[data-empty-state]')!.getAttribute('data-empty-state')).toBe('no-results');

    answer([ROW]);
    await userEvent.click(screen.getByRole('button', { name: 'common.emptyState.clearFilters' }));
    expect(owner.value).toBe('');
    expect(await screen.findByText('b2b')).toBeTruthy();
    await waitFor(() => expect(listComparisons.mock.calls.at(-1)![0]).toEqual({}));
  });
});
