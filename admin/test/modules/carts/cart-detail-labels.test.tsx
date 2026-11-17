import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1387 — the admin cart detail printed the raw cart status and approval
 * status codes in its badges, and most of its keys (`carts.detail.*`,
 * `carts.reject.*`, `carts.audit.*`, the detail-only `carts.column.*`) were in
 * no catalogue, so the operator read `carts.carts.…` keys. The carts list kept
 * two English literals: the `(anonymous)` owner fallback and the mobile
 * `N items` meta line.
 *
 * Rendered against the shipped catalogues in `en` and `pl`. The Polish run uses
 * Polish as its own fallback (`renderWithI18n`), so a key missing from `pl.json`
 * shows up as a raw key instead of hiding behind English.
 */
const getSpy = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

/**
 * `ResponsiveTable` renders a column's `meta` on a mobile card only for the
 * primary column, so the total column's item-count line never reaches the DOM.
 * The wrapper records the columns the list declares, so the test can read the
 * line the column produces without depending on which columns the card shows.
 */
const tableColumns: { current: { id: string; meta?: (row: unknown) => unknown }[] } = { current: [] };
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>('@endora-commerce/admin-kit/components');
  const ResponsiveTable = (props: Parameters<typeof actual.ResponsiveTable>[0]): ReactNode => {
    tableColumns.current = props.columns as typeof tableColumns.current;
    return actual.ResponsiveTable(props);
  };
  return { ...actual, ResponsiveTable };
});

const { contributions } = await import('@endora-commerce/mod-carts/admin');
const CartsList = (await contributions.routes![0]!.component()).default as () => ReactNode;
const CartDetail = (await contributions.routes![1]!.component()).default as () => ReactNode;

const read = (path: string): Record<string, string> =>
  JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
const CATALOGUES = {
  en: { core: read('../packages/modules/_i18n/i18n/en.json'), carts: read('../packages/modules/carts/i18n/en.json') },
  pl: { core: read('../packages/modules/_i18n/i18n/pl.json'), carts: read('../packages/modules/carts/i18n/pl.json') },
};

const CODES = ['active', 'abandoned', 'completed', 'rejected', 'not_required', 'pending', 'approved', 'rejected_by_org_admin'];
const CART_ID = '00000000-0000-4000-8000-0000000000c1';

function detailFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CART_ID,
    ownerDisplayName: null,
    organizationDisplayName: 'Acme',
    salesChannelCode: 'default',
    status: 'abandoned',
    approvalStatus: 'rejected_by_org_admin',
    items: [
      {
        id: '00000000-0000-4000-8000-0000000000e1',
        productId: '00000000-0000-4000-8000-000000000101',
        productName: 'Sample',
        variantId: null,
        quantity: 2,
        unitPrice: { amount: 19.99, currency: 'PLN' },
        lineTotal: { amount: 39.98, currency: 'PLN' },
      },
    ],
    total: { amount: 29.98, currency: 'PLN' },
    discount: { code: 'SAVE10', amount: 10, currency: 'PLN' },
    appliedPromotionCode: 'SAVE10',
    lastActivityAt: '2026-05-22T12:00:00Z',
    createdAt: '2026-05-22T11:00:00Z',
    convertedToQuoteRequestId: '00000000-0000-4000-8000-0000000000f1',
    submittedForApprovalAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectedByActor: 'admin@example.com',
    rejectedReason: 'Over budget',
    ...overrides,
  };
}

const AUDIT_ROW = {
  id: '00000000-0000-4000-8000-0000000000a1',
  occurredAt: '2026-05-22T12:00:00Z',
  actorType: 'org_admin',
  actorDisplayName: 'Boss',
  action: 'approval_rejected',
  fromState: 'pending',
  toState: 'rejected_by_org_admin',
  reason: 'Over budget',
};

/** Every actor type and action the carts module records (`cart-audit-entry.entity.ts`). */
const ACTOR_TYPES = ['customer', 'org_admin', 'platform_admin', 'system', 'sweep'];
const ACTIONS = [
  'status_changed',
  'approval_submitted',
  'approval_approved',
  'approval_rejected',
  'approval_policy_reset',
  'approval_resubmission_required',
  'coupon_applied',
  'coupon_dropped',
  'converted_to_qr',
  'created_from_qr',
  'created_from_shopping_list',
  'admin_rejected',
  'abandonment_swept',
  'abandonment_reactivated',
  'line_added',
  'line_removed',
  'line_qty_changed',
  'cart_merged_from_anon',
  'lines_restored_from_rejection',
];

/** Leaf nodes whose whole text is a raw status code. */
function rawCodesOnScreen(): string[] {
  return [...document.body.querySelectorAll('*')]
    .filter((node) => node.childElementCount === 0)
    .map((node) => node.textContent?.trim() ?? '')
    .filter((text) => CODES.includes(text));
}

function expectNoRawKey(): void {
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(/\bcarts\.[a-z]/);
  expect(text).not.toMatch(/\bcore\.[a-z]/);
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
});
afterEach(() => cleanup());

describe.each(['en', 'pl'] as const)('Cart detail labels (%s) — issue #1387', (language) => {
  const { carts: own } = CATALOGUES[language];

  function renderDetail(cart: Record<string, unknown>, audit: unknown[]): void {
    getSpy.mockImplementation((url: string) =>
      Promise.resolve({ data: url.endsWith('/audit') ? audit : cart }),
    );
    renderWithI18n(
      <MemoryRouter initialEntries={[`/carts/${CART_ID}`]}>
        <Routes>
          <Route path="/carts/:id" element={<CartDetail />} />
        </Routes>
      </MemoryRouter>,
      CATALOGUES[language],
      { language },
    );
  }

  it('labels the status and approval badges from the carts catalogue', async () => {
    renderDetail(detailFixture(), [AUDIT_ROW]);
    await screen.findByText('Sample');
    expect(screen.getByText(own['carts.status.abandoned']!)).toBeInTheDocument();
    expect(screen.getByText(own['carts.approvalStatus.rejected_by_org_admin']!)).toBeInTheDocument();
    expect(rawCodesOnScreen()).toEqual([]);
  });

  it('labels the audit feed: actor type, action and both states (issue #1476)', async () => {
    renderDetail(detailFixture(), [AUDIT_ROW]);
    await screen.findByText('Sample');
    const feed = screen.getAllByRole('table')[1]!;
    expect(within(feed).getByText(own['carts.audit.actor.org_admin']!)).toBeInTheDocument();
    expect(within(feed).getByText(own['carts.audit.actionLabel.approval_rejected']!)).toBeInTheDocument();
    expect(within(feed).getByText(new RegExp(own['carts.approvalStatus.pending']!))).toBeInTheDocument();
    const leaves = [...feed.querySelectorAll('*')]
      .filter((node) => node.childElementCount === 0)
      .map((node) => node.textContent?.trim() ?? '');
    for (const raw of ['org_admin', 'approval_rejected', 'pending', 'rejected_by_org_admin']) {
      expect(leaves.some((text) => text.includes(raw)), raw).toBe(false);
    }
  });

  it('ships a label for every recorded actor type and action', () => {
    for (const actor of ACTOR_TYPES) expect(own[`carts.audit.actor.${actor}`], actor).toBeTruthy();
    for (const action of ACTIONS) expect(own[`carts.audit.actionLabel.${action}`], action).toBeTruthy();
  });

  it('keeps the cart UUID out of the page header (issue #1477)', async () => {
    renderDetail(detailFixture({ ownerDisplayName: 'Jane Buyer' }), []);
    await screen.findByText('Sample');
    const header = document.querySelector('header');
    expect(header?.textContent).not.toContain(CART_ID);
    expect(header?.textContent).toContain('Jane Buyer');
  });

  it('shows no raw catalogue key on a cart with every optional section and an audit feed', async () => {
    renderDetail(detailFixture(), [AUDIT_ROW]);
    await screen.findByText('Sample');
    expect(screen.getByText(own['carts.owner.anonymous']!)).toBeInTheDocument();
    expect(screen.getByText(own['carts.column.discount']!)).toBeInTheDocument();
    expectNoRawKey();
  });

  it('shows no raw catalogue key in the reject form or the empty audit feed', async () => {
    renderDetail(detailFixture({ status: 'active', approvalStatus: 'not_required' }), []);
    await screen.findByText('Sample');
    expect(screen.getByText(own['carts.detail.auditEmpty']!)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: own['carts.reject.open']! }));
    expect(screen.getByLabelText(own['carts.reject.reasonLabel']!)).toBeInTheDocument();
    expectNoRawKey();
    expect(rawCodesOnScreen()).toEqual([]);
  });

  it('shows the catalogue message when the cart does not load', async () => {
    getSpy.mockRejectedValue(new Error('boom'));
    renderWithI18n(
      <MemoryRouter initialEntries={[`/carts/${CART_ID}`]}>
        <Routes>
          <Route path="/carts/:id" element={<CartDetail />} />
        </Routes>
      </MemoryRouter>,
      CATALOGUES[language],
      { language },
    );
    expect(await screen.findByText(own['carts.detail.loadFailed']!)).toBeInTheDocument();
    expectNoRawKey();
  });
});

describe.each(['en', 'pl'] as const)('Carts list literals (%s) — issue #1387', (language) => {
  const { carts: own } = CATALOGUES[language];
  const ROW = {
    id: CART_ID,
    ownerCustomerAccountId: null,
    ownerDisplayName: null,
    organizationId: null,
    organizationDisplayName: null,
    salesChannelCode: null,
    status: 'active',
    approvalStatus: 'not_required',
    itemCount: 3,
    total: { amount: 124.5, currency: 'PLN' },
    appliedPromotionCode: null,
    lastActivityAt: '2026-05-22T12:00:00Z',
    createdAt: '2026-05-22T11:00:00Z',
  };

  function renderList(): void {
    getSpy.mockResolvedValue({ data: [ROW] });
    renderWithI18n(
      <MemoryRouter>
        <CartsList />
      </MemoryRouter>,
      CATALOGUES[language],
      { language },
    );
  }

  it('labels an anonymous owner from the carts catalogue', async () => {
    renderList();
    const table = await screen.findByRole('table');
    expect(within(table).getByText(own['carts.owner.anonymous']!)).toBeInTheDocument();
  });

  it('leads each row with its owner, linked to the cart, and no UUID (issue #1477)', async () => {
    getSpy.mockResolvedValue({ data: [{ ...ROW, ownerDisplayName: 'Jane Buyer' }] });
    renderWithI18n(
      <MemoryRouter>
        <CartsList />
      </MemoryRouter>,
      CATALOGUES[language],
      { language },
    );
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'Jane Buyer' })).toHaveAttribute('href', `/carts/${CART_ID}`);
    expect(table.textContent).not.toContain(CART_ID.slice(0, 8));
  });

  it('labels the item-count meta line from the carts catalogue', async () => {
    renderList();
    await screen.findByRole('table');
    const total = tableColumns.current.find((col) => col.id === 'total');
    expect(own['carts.itemCount'], `carts.itemCount in ${language}.json`).toContain('{count}');
    expect(total?.meta?.(ROW)).toBe(own['carts.itemCount']!.replace('{count}', '3'));
  });

  it('shows no raw catalogue key on the mobile cards', async () => {
    setMobileViewport(true);
    renderList();
    await screen.findByText(own['carts.owner.anonymous']!);
    expectNoRawKey();
  });
});
