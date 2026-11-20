import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { CreditLimitView } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1664 (UX audit SALES-24, #1500; SALES-19, #1544) — the credit-limits
 * list read the whole roster into a plain table with an *Open* button per row,
 * and *Open* drew the adjust form under a separate "Per-organization editor"
 * look-up card, off screen. It is the kit `ListPage` now, server-paged through
 * the endpoint's `page` / `pageSize`; *Grant credit limit* is the header
 * action, and granting or adjusting happens in a dialog opened from the header
 * or the row's menu.
 */
installOffsetParentShim();

const NEW_ORG = '00000000-0000-4000-8000-0000000000ee';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => api.get(...a),
      post: (...a: unknown[]) => api.post(...a),
      put: vi.fn(),
      patch: (...a: unknown[]) => api.patch(...a),
      delete: vi.fn(),
    },
  };
});

// The picker searches the organizations endpoint; the screen only needs the id it answers.
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    OrganizationPicker: ({ onChange, id }: { onChange: (v: string | null) => void; id?: string }) => (
      <button id={id} type="button" onClick={() => onChange(NEW_ORG)}>
        pick organization
      </button>
    ),
  };
});

const { CreditLimitsPage } = await import('../../../../packages/modules/credit_limits/src/admin/pages/CreditLimitsPage');

const BUNDLE = { ...shippedCoreBundle('en'), ...shippedModuleBundle('credit_limits', 'en') };
const core = BUNDLE.core!;
const cl = BUNDLE.credit_limits!;

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

const limit = (n: number, overrides: Partial<CreditLimitView> = {}): CreditLimitView => ({
  organizationId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  organizationName: `Org ${n}`,
  grantedAmount: 1000,
  availableAmount: 900,
  currency: 'PLN',
  activeReservationCount: 1,
  activeReservations: [
    {
      orderId: '00000000-0000-4000-8000-0000000000c1',
      orderBusinessId: 'ORD-0001-2026',
      amount: 100,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  grantedAt: '2026-08-17T10:00:00.000Z',
  ...overrides,
});

const notGranted = (): ApiError =>
  new ApiError(404, { error: { code: 'CREDIT_LIMIT_NOT_GRANTED', message: 'Not granted.' } } as never);

/** The list answers `rows`; an organization's own limit is the row naming it, else 404. */
function answer(rows: CreditLimitView[], total = rows.length): void {
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/admin/credit-limits')) {
      const query = new URLSearchParams(path.split('?')[1] ?? '');
      return { data: rows, meta: { page: Number(query.get('page')), pageSize: Number(query.get('pageSize')), total } };
    }
    const own = /^\/api\/v1\/admin\/organizations\/([^/]+)\/credit-limit$/.exec(path);
    if (own) {
      const row = rows.find((r) => r.organizationId === own[1]);
      if (row) return { data: row };
      throw notGranted();
    }
    if (path === `/api/v1/admin/organizations/${NEW_ORG}`) return { data: { name: 'Fresh Org' } };
    // The currency picker's dictionary, and anything else the forms read.
    return { data: [] };
  });
}

const listCalls = (): URLSearchParams[] =>
  api.get.mock.calls
    .map((c) => c[0] as string)
    .filter((p) => p.startsWith('/api/v1/admin/credit-limits'))
    .map((p) => new URLSearchParams(p.split('?')[1] ?? ''));

function render(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <CreditLimitsPage />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }) },
    ),
    BUNDLE,
  );
}

async function openRowMenu(name: string): Promise<HTMLElement> {
  fireEvent.pointerDown(await screen.findByRole('button', { name: fill(cl['list.rowMenu.label']!, { name }) }), {
    button: 0,
    ctrlKey: false,
  });
  return screen.findByRole('menu');
}

beforeEach(() => {
  setMobileViewport(false);
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
});
afterEach(() => cleanup());

describe('CreditLimitsPage (issue #1664)', () => {
  it('asks the endpoint for one page and draws the kit pager over its total', async () => {
    answer([limit(1), limit(2)], 45);
    render();
    expect(await screen.findByText('Showing 1–20 of 45')).toBeInTheDocument();
    expect(listCalls()[0]!.get('page')).toBe('1');
    expect(listCalls()[0]!.get('pageSize')).toBe('20');
    expect(screen.getByText(fill(cl['list.count']!, { count: 45 }))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    await waitFor(() => expect(listCalls().at(-1)!.get('page')).toBe('2'));
  });

  it('has no look-up card and no Open button; the organization opens from the row menu', async () => {
    answer([limit(1)]);
    render();
    await screen.findByText('Org 1');
    expect(screen.queryByRole('button', { name: core['creditLimits.action.grant']! })).toBeNull();
    expect(screen.queryByText('pick organization')).toBeNull();
    const menu = await openRowMenu('Org 1');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([cl['list.adjust'], cl['list.openOrganization']]);
    expect(within(menu).getByRole('menuitem', { name: cl['list.openOrganization']! })).toHaveAttribute(
      'href',
      '/organizations/00000000-0000-4000-8000-000000000001',
    );
  });

  it('adjusts a limit in a dialog opened from the row, then says so beside the list', async () => {
    answer([limit(1)]);
    api.patch.mockResolvedValue({ data: limit(1, { grantedAmount: 2000 }) });
    render();
    const menu = await openRowMenu('Org 1');
    await userEvent.click(within(menu).getByRole('menuitem', { name: cl['list.adjust']! }));
    const dialog = await screen.findByRole('dialog', {
      name: fill(core['creditLimits.adjust.title']!, { orgId: 'Org 1', currency: 'PLN' }),
    });
    // The reservations are listed under the order's customer-facing number (issue #1178).
    expect(within(dialog).getByRole('link', { name: 'ORD-0001-2026' })).toHaveAttribute(
      'href',
      '/orders/00000000-0000-4000-8000-0000000000c1',
    );
    const amount = within(dialog).getByLabelText(fill(core['creditLimits.field.newGranted']!, { currency: 'PLN' }));
    await userEvent.clear(amount);
    await userEvent.type(amount, '2000');
    await userEvent.click(within(dialog).getByRole('button', { name: core['creditLimits.action.saveAdjust']! }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/v1/admin/organizations/00000000-0000-4000-8000-000000000001/credit-limit', {
        grantedAmount: 2000,
        allowOverAllocation: false,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(fill(core['creditLimits.success.adjust']!, { orgId: 'Org 1' }))).toBeInTheDocument();
    expect(listCalls().length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a refused adjustment in the dialog with the server message', async () => {
    answer([limit(1)]);
    api.patch.mockRejectedValue(
      new ApiError(409, { error: { code: 'ADJUSTMENT_BELOW_ACTIVE', message: 'Below active.' } } as never),
    );
    render();
    const menu = await openRowMenu('Org 1');
    await userEvent.click(within(menu).getByRole('menuitem', { name: cl['list.adjust']! }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: core['creditLimits.action.saveAdjust']! }));
    expect(await within(dialog).findByText('Below active.')).toBeInTheDocument();
  });

  it('grants from the header: pick an organization, and one without a limit gets the grant form', async () => {
    answer([limit(1)]);
    api.post.mockResolvedValue({ data: limit(99) });
    render();
    const header = screen.getByRole('heading', { level: 1, name: core['creditLimits.page.title']! }).closest('header')!;
    await userEvent.click(within(header).getByRole('button', { name: cl['list.grant']! }));
    const dialog = await screen.findByRole('dialog', { name: cl['list.grant']! });
    expect(within(dialog).queryByRole('button', { name: core['creditLimits.action.grant']! })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'pick organization' }));
    expect(await within(dialog).findByText(core['creditLimits.grant.notGrantedYet']!)).toBeInTheDocument();
    const amount = within(dialog).getByLabelText(core['creditLimits.field.grantedAmount']!);
    await userEvent.clear(amount);
    await userEvent.type(amount, '7500');
    await userEvent.click(within(dialog).getByRole('button', { name: core['creditLimits.action.grant']! }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/api/v1/admin/organizations/${NEW_ORG}/credit-limit`, {
        grantedAmount: 7500,
        currency: 'PLN',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      await screen.findByText(fill(core['creditLimits.success.grant']!, { amount: 7500, currency: 'PLN', orgId: 'Fresh Org' })),
    ).toBeInTheDocument();
  });

  it('offers the adjust form when the picked organization already holds a limit', async () => {
    const held = limit(1, { organizationId: NEW_ORG, organizationName: 'Fresh Org' });
    answer([held]);
    render();
    await screen.findByText('Fresh Org');
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    await userEvent.click(within(header).getByRole('button', { name: cl['list.grant']! }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'pick organization' }));
    expect(
      await within(dialog).findByLabelText(fill(core['creditLimits.field.newGranted']!, { currency: 'PLN' })),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: core['creditLimits.action.saveAdjust']! })).toBeInTheDocument();
  });

  it('shows the empty state with the grant action, and a translated error with Retry', async () => {
    answer([]);
    render();
    const title = await screen.findByText(cl['list.emptyTitle']!);
    const empty = title.closest('.b2b-empty') as HTMLElement;
    expect(within(empty).getByRole('button', { name: cl['list.grant']! })).toBeInTheDocument();
    // The empty state's Grant is the one primary; the header's is hidden meanwhile.
    expect(screen.getAllByRole('button', { name: cl['list.grant']! })).toHaveLength(1);
    cleanup();
    api.get.mockReset();
    api.get.mockRejectedValueOnce(new Error('network'));
    answer([limit(1)]);
    render();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(core['common.list.loadError']!);
    await userEvent.click(within(alert).getByRole('button', { name: core['common.action.retry']! }));
    expect(await screen.findByText('Org 1')).toBeInTheDocument();
  });
});
