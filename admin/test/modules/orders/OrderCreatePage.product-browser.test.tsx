import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminMe } from '@endora-commerce/admin-kit/lib';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ADMIN_PREFERENCES_DEFAULTS, ADMIN_PRODUCT_SELECTION_MAX } from '@endora-commerce/contracts';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 145, User Story 1 (FR-020, FR-022…FR-024, FR-026): on Create order,
 * lines are added through **Browse products** (the shared picker, many at once)
 * or the quick search beside it (one at a time); each line shows name, SKU,
 * quantity, unit price and line total, or the one reason the preview gave for
 * not pricing it.
 *
 * **The bundle is `_i18n`'s shipped English one, read off disk** — as
 * `kit-product-browser.test.tsx` does — so a reason key that does not exist
 * fails here instead of passing as its own name, and the picker's interpolated
 * strings ("Add 8", "8 selected") read as an operator sees them.
 *
 * **The server is a small fake**: the catalogue list filters, counts and
 * paginates what the picker asks for, and the preview prices whatever lines the
 * page sends (10.00 each), with per-test unavailability codes on top. A case
 * that asserts a request and what the screen shows for it then proves the two
 * agree.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const navigateSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => getSpy(...a),
      post: (...a: unknown[]) => postSpy(...a),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const { OrderCreatePage } = await import('../../../../packages/modules/orders/src/admin/pages/OrderCreatePage');
const { ApiError, formatMoney } = await import('@endora-commerce/admin-kit/lib');

// ---------------------------------------------------------------- bundle

const REPO_ROOT = resolve(process.cwd(), '..');
const CORE: Record<string, string> = JSON.parse(
  readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const BUNDLE: Bundle = { core: CORE };

// ---------------------------------------------------------------- fake catalogue

type Status = 'active' | 'inactive';
type Type = 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';

interface Row {
  id: string;
  sku: string;
  slug: string;
  name: Record<string, string>;
  status: Status;
  type: Type;
  /** Feature 163 (FR-019) — archived is its own axis, independent of status. */
  archivedAt: string | null;
}

function product(
  id: string,
  name: string,
  status: Status = 'active',
  type: Type = 'simple',
  archivedAt: string | null = null,
): Row {
  return { id, sku: `SKU-${id.toUpperCase()}`, slug: id, name: { 'en-US': name }, status, type, archivedAt };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * g1 (active, grouped), p1 and i1 (inactive), then a01…a24 — all active simple — and
 * x1, an active product that is archived (feature 163).
 */
const CATALOG: Row[] = [
  product('g1', 'Grouped set', 'active', 'grouped'),
  product('p1', 'Paused widget', 'inactive'),
  product('i1', 'Old widget', 'inactive'),
  ...Array.from({ length: 24 }, (_, i) => product(`a${pad(i + 1)}`, `Widget ${pad(i + 1)}`)),
  product('x1', 'Retired widget', 'active', 'simple', '2026-10-20T00:00:00.000Z'),
];

const LIST_PATH = '/api/v1/admin/catalog/products';

function serveCatalog(catalog: readonly Row[], url: string): unknown {
  const params = new URLSearchParams(url.split('?')[1] ?? '');
  // The list's rules (feature 163, R30.4): archived excluded by default,
  // `includeArchived=1` includes them, `archived` wins when sent.
  const archivedMode =
    params.get('archived') ?? (params.get('includeArchived') === '1' ? 'include' : 'exclude');
  const status = params.get('status');
  const type = params.get('type');
  const q = (params.get('q') ?? '').toLowerCase();
  const page = Number(params.get('page') ?? '0');
  const pageSize = Number(params.get('pageSize') ?? '20');
  const matches = catalog.filter(
    (p) =>
      (type === null || p.type === type) &&
      (q === '' ||
        p.sku.toLowerCase().includes(q) ||
        p.slug.includes(q) ||
        Object.values(p.name).some((n) => n.toLowerCase().includes(q))),
  );
  const live = matches.filter((p) => p.archivedAt === null);
  const archived = matches.filter((p) => p.archivedAt !== null);
  const base = archivedMode === 'only' ? archived : archivedMode === 'include' ? matches : live;
  const filtered = base.filter((p) => status === null || p.status === status);
  return {
    data: filtered.slice(page * pageSize, (page + 1) * pageSize),
    pagination: { page, pageSize, total: filtered.length },
    counts: {
      all: live.length,
      active: live.filter((p) => p.status === 'active').length,
      inactive: live.filter((p) => p.status === 'inactive').length,
      archived: archived.length,
    },
  };
}

// ---------------------------------------------------------------- fake preview

const UNIT = 10;
/** Per-product unavailability codes the next previews report. */
let unavailableCodes: Record<string, string> = {};

interface PreviewBody {
  customerAccountId: string;
  salesChannelId: string;
  deliveryMethodId?: string;
  paymentMethodId?: string;
  items: Array<{ productId: string; quantity: number }>;
}

function servePreview(body: PreviewBody): unknown {
  const lines = body.items.map((it) => {
    const code = unavailableCodes[it.productId];
    return code !== undefined
      ? { productId: it.productId, quantity: it.quantity, unitPrice: '0', currency: 'PLN', lineTotal: 0, unavailable: true }
      : {
          productId: it.productId,
          quantity: it.quantity,
          unitPrice: UNIT.toFixed(2),
          currency: 'PLN',
          lineTotal: UNIT * it.quantity,
        };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const deliveryTotal = body.deliveryMethodId ? 15 : 0;
  const paymentSurcharge = body.paymentMethodId ? 2 : 0;
  return {
    data: {
      lines,
      summary: {
        subtotal,
        taxTotal: 0,
        deliveryTotal,
        paymentSurcharge,
        discountTotal: 0,
        total: subtotal + deliveryTotal + paymentSurcharge,
        currency: 'PLN',
      },
      messages: body.items
        .filter((it) => unavailableCodes[it.productId] !== undefined)
        .map((it) => ({ productId: it.productId, code: unavailableCodes[it.productId]! })),
    },
  };
}

// ---------------------------------------------------------------- rig

const SESSION = adminSession({ permissions: ['*'] });
/**
 * The page size the Product list and this picker share (`catalog-products`),
 * seeded on the session as the server would send it (feature 164 moved it off
 * `localStorage`).
 */
let catalogPageSize = 10;
const sessionWithPageSize = (): AdminMe => ({
  ...SESSION,
  preferences: { ...ADMIN_PREFERENCES_DEFAULTS, listPageSizes: { 'catalog-products': catalogPageSize } },
});
/** The kit's own client, which the preferences store writes through. */
const kitClient = (
  await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')
).apiClient;
const CUSTOMER = { id: 'cust-1', email: 'jan@acme.test', firstName: 'Jan', lastName: 'Kowalski', organizationName: 'Acme' };
const ORG_ADDRESS = {
  id: 'addr-1',
  recipientName: 'Acme HQ',
  street: 'Main 1',
  city: 'Warsaw',
  postalCode: '00-001',
  country: 'PL',
  isDefault: true,
};

let catalog: Row[] = CATALOG;

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  unavailableCodes = {};
  catalog = CATALOG;
  catalogPageSize = 10;
  vi.spyOn(kitClient, 'patch').mockResolvedValue({ data: ADMIN_PREFERENCES_DEFAULTS });
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/addresses')) {
      return Promise.resolve({ data: { personal: [], organization: [ORG_ADDRESS] } });
    }
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith(`${LIST_PATH}?`)) return Promise.resolve(serveCatalog(catalog, path));
    if (path.startsWith(`${LIST_PATH}/`)) {
      const row = catalog.find((p) => p.id === path.slice(LIST_PATH.length + 1));
      return row ? Promise.resolve({ data: row }) : Promise.reject(new Error('not found'));
    }
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({ items: [{ id: 'chan-1', code: 'CH', name: { 'en-US': 'Channel 1' }, active: true }] });
    }
    if (path.startsWith('/api/v1/admin/payment-methods')) {
      return Promise.resolve({ data: [{ id: 'pay-1', code: 'PM', name: { 'en-US': 'Payment 1' }, status: 'active' }] });
    }
    if (path.startsWith('/api/v1/admin/delivery-methods')) {
      return Promise.resolve({ data: [{ id: 'del-1', code: 'DM', name: { 'en-US': 'Delivery 1' }, status: 'active' }] });
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string, body: unknown) => {
    if (path.endsWith('/orders/preview')) return Promise.resolve(servePreview(body as PreviewBody));
    return Promise.resolve({ data: { id: 'new-order-1' } });
  });
});

/** Opened with the customer and the channel chosen, so **Items** shows at once. */
function renderPage(): void {
  // <StrictMode>, as the admin renders (admin-shell's AdminRoot): its dev
  // double-mount is what an effect cleared only in cleanup does not survive.
  renderWithI18n(
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={['/orders/new?customerAccountId=cust-1&salesChannelId=chan-1']}>
          <OrderCreatePage />
        </MemoryRouter>,
        { session: sessionWithPageSize(), presence: modulePresence({ present: ['orders', 'quick_order'] }) },
      )}
    </StrictMode>,
    BUNDLE,
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function openPicker(user: User): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Browse products' }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(dialog.querySelector('[aria-busy="true"]')).toBeNull());
  await waitFor(() => expect(within(dialog).queryAllByRole('checkbox').length).toBeGreaterThan(1));
  return dialog;
}

function rowCheckbox(dialog: HTMLElement, name: string): HTMLInputElement {
  return within(dialog).getByRole('checkbox', { name: `Select ${name}` }) as HTMLInputElement;
}

/** Open the picker, tick `names` on its first page, and add them. */
async function addThroughPicker(user: User, names: string[]): Promise<void> {
  const dialog = await openPicker(user);
  for (const name of names) await user.click(rowCheckbox(dialog, name));
  await user.click(within(dialog).getByRole('button', { name: `Add ${names.length}` }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

/** The table row of the line for `name`. */
function lineRow(name: string): HTMLElement {
  const row = screen.getByText(name, { selector: '[data-line-name]' }).closest('tr');
  if (!row) throw new Error(`no line row for ${name}`);
  return row as HTMLElement;
}

function lineNames(): string[] {
  return Array.from(document.querySelectorAll('[data-line-name]')).map((el) => el.textContent ?? '');
}

const previewBodies = (): PreviewBody[] =>
  postSpy.mock.calls
    .filter(([path]) => path === '/api/v1/admin/orders/preview')
    .map(([, body]) => body as PreviewBody);

/** As the screen formats it, with the non-breaking space Testing Library's matcher normalises away. */
const money = (amount: number): string => formatMoney(amount, 'PLN').replace(/\s+/g, ' ');

/** The **Total** row of the order summary, as shown — `null` while there is no summary. */
function summaryTotal(): string | null {
  const label = screen.queryByText(CORE['orderCreate.summary.total']!, { selector: 'span' });
  return label?.nextElementSibling?.textContent?.replace(/\s+/g, ' ') ?? null;
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Create order' });
}

async function pickOption(user: User, comboLabel: string, optionLabel: string): Promise<void> {
  await user.click(screen.getByLabelText(comboLabel));
  await user.click(await screen.findByRole('option', { name: new RegExp(optionLabel) }));
}

// ---------------------------------------------------------------- cases

describe('OrderCreatePage — Browse products and the quick search (US1)', () => {
  it('starts with no lines and an empty state, and has no per-row product search', () => {
    renderPage();
    expect(screen.getByText(CORE['orderCreate.items.empty']!)).toBeInTheDocument();
    expect(screen.queryByLabelText('product-0')).toBeNull();
    expect(screen.getByRole('button', { name: 'Browse products' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: CORE['orderCreate.items.quickSearch']! })).toBeInTheDocument();
  });

  it('opens on Active with the order rules: grouped and inactive shown with a reason, archived not offered (sc. 1, 7)', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openPicker(user);

    expect(within(dialog).getByRole('tab', { name: /^Active/ }).getAttribute('aria-selected')).toBe('true');
    expect(getSpy.mock.calls.map(([p]) => String(p))).toContain(
      `${LIST_PATH}?page=0&pageSize=10&status=active`,
    );
    expect(within(dialog).getByRole('heading', { name: CORE['orderCreate.items.browse']! })).toBeInTheDocument();

    // Feature 163 (FR-019) — an order cannot take an archived product, so the
    // browser offers no Archived tab, and All leaves archived products out.
    expect(within(dialog).queryByRole('tab', { name: /^Archived/ })).toBeNull();
    expect(within(dialog).queryByRole('tab', { name: /^Draft/ })).toBeNull();
    await user.click(within(dialog).getByRole('tab', { name: /^All/ }));
    await waitFor(() => expect(within(dialog).getByText('Grouped set')).toBeInTheDocument());
    expect(within(dialog).queryByText('Retired widget')).toBeNull();
    for (const [name, reason] of [
      ['Grouped set', 'productBrowser.reason.groupParent'],
      ['Paused widget', 'productBrowser.reason.notActive'],
      ['Old widget', 'productBrowser.reason.notActive'],
    ] as const) {
      const box = rowCheckbox(dialog, name);
      expect(box.disabled).toBe(true);
      expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe(CORE[reason]);
    }
  });

  it('adds 5 + 3 ticked across a page change and a filter change as 8 priced lines in tick order (sc. 2, 3)', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openPicker(user);

    const firstPage = ['Widget 01', 'Widget 02', 'Widget 03', 'Widget 04', 'Widget 05'];
    for (const name of firstPage) await user.click(rowCheckbox(dialog, name));
    await user.click(within(dialog).getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(within(dialog).getByText('Widget 11')).toBeInTheDocument());
    await user.click(rowCheckbox(dialog, 'Widget 11'));
    await user.click(rowCheckbox(dialog, 'Widget 12'));
    await user.type(within(dialog).getByRole('searchbox'), 'Widget 2');
    await waitFor(() => expect(within(dialog).getByText('Widget 21')).toBeInTheDocument());
    await user.click(rowCheckbox(dialog, 'Widget 21'));
    expect(within(dialog).getByText('8 selected')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Add 8' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(lineNames()).toEqual([...firstPage, 'Widget 11', 'Widget 12', 'Widget 21']);
    expect(within(lineRow('Widget 11')).getByText('SKU-A11')).toBeInTheDocument();
    expect(within(lineRow('Widget 11')).getByRole('textbox', { name: 'Quantity Widget 11' })).toHaveValue('1');

    await waitFor(() => expect(previewBodies().at(-1)?.items).toHaveLength(8));
    expect(previewBodies().at(-1)?.items[0]).toEqual({ productId: 'a01', quantity: 1 });
    await waitFor(() => expect(within(lineRow('Widget 21')).getAllByText(money(10))).toHaveLength(2));
    await waitFor(() => expect(summaryTotal()).toBe(money(80)));
  });

  it('re-prices the line and the summary when a quantity changes (sc. 4)', async () => {
    const user = userEvent.setup();
    renderPage();
    await addThroughPicker(user, ['Widget 01', 'Widget 02']);
    await waitFor(() => expect(summaryTotal()).toBe(money(20)));

    const qty = screen.getByRole('textbox', { name: 'Quantity Widget 01' });
    await user.clear(qty);
    await user.type(qty, '3');

    await waitFor(() =>
      expect(previewBodies().at(-1)?.items).toEqual([
        { productId: 'a01', quantity: 3 },
        { productId: 'a02', quantity: 1 },
      ]),
    );
    await waitFor(() => expect(within(lineRow('Widget 01')).getByText(money(30))).toBeInTheDocument());
    await waitFor(() => expect(summaryTotal()).toBe(money(40)));
  });

  it('re-prices with the lines unchanged when the delivery and then the payment method change (FR-023)', async () => {
    const user = userEvent.setup();
    renderPage();
    await addThroughPicker(user, ['Widget 01', 'Widget 02']);
    await waitFor(() => expect(summaryTotal()).toBe(money(20)));
    const items = [
      { productId: 'a01', quantity: 1 },
      { productId: 'a02', quantity: 1 },
    ];

    await pickOption(user, 'deliveryMethodId', 'Delivery 1');
    await waitFor(() => expect(previewBodies().at(-1)).toMatchObject({ deliveryMethodId: 'del-1', items }));
    expect(previewBodies().at(-1)).not.toHaveProperty('paymentMethodId');
    await waitFor(() => expect(summaryTotal()).toBe(money(35)));

    await pickOption(user, 'paymentMethodId', 'Payment 1');
    await waitFor(() =>
      expect(previewBodies().at(-1)).toMatchObject({ deliveryMethodId: 'del-1', paymentMethodId: 'pay-1', items }),
    );
    await waitFor(() => expect(summaryTotal()).toBe(money(37)));
    expect(lineNames()).toEqual(['Widget 01', 'Widget 02']);
  });

  it('a product already a line can be picked again, as a line of its own (feature 159, N-31)', async () => {
    const user = userEvent.setup();
    renderPage();
    await addThroughPicker(user, ['Widget 01']);

    const dialog = await openPicker(user);
    const box = rowCheckbox(dialog, 'Widget 01');
    expect(box.disabled).toBe(false);
    await user.click(box);
    await user.click(within(dialog).getByRole('button', { name: 'Add 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(lineNames()).toEqual(['Widget 01', 'Widget 01']);
    // Each line is priced on its own.
    await waitFor(() =>
      expect(previewBodies().at(-1)?.items).toEqual([
        { productId: 'a01', quantity: 1 },
        { productId: 'a01', quantity: 1 },
      ]),
    );
  });

  it('adds nothing on cancel and keeps the existing lines (sc. 10)', async () => {
    const user = userEvent.setup();
    renderPage();
    await addThroughPicker(user, ['Widget 01']);

    const dialog = await openPicker(user);
    await user.click(rowCheckbox(dialog, 'Widget 02'));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(lineNames()).toEqual(['Widget 01']);
  });

  it(`stops a single Add at ${ADMIN_PRODUCT_SELECTION_MAX} products (sc. 9)`, async () => {
    catalog = Array.from({ length: ADMIN_PRODUCT_SELECTION_MAX + 5 }, (_, i) =>
      product(`b${String(i).padStart(3, '0')}`, `Bulk ${String(i).padStart(3, '0')}`),
    );
    catalogPageSize = 500;
    const user = userEvent.setup();
    renderPage();
    const dialog = await openPicker(user);

    await user.click(within(dialog).getByRole('checkbox', { name: 'Select all selectable products on this page' }));
    expect(within(dialog).getByText(`${ADMIN_PRODUCT_SELECTION_MAX} selected`)).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        `You can add up to ${ADMIN_PRODUCT_SELECTION_MAX} products at a time. Add these, then open the picker again for more.`,
      ),
    ).toBeInTheDocument();
    expect(rowCheckbox(dialog, `Bulk ${ADMIN_PRODUCT_SELECTION_MAX}`).disabled).toBe(true);
  });

  it('appends one line from the quick search by SKU, under the same rules (sc. 8, FR-020)', async () => {
    const user = userEvent.setup();
    renderPage();
    await addThroughPicker(user, ['Widget 01']);
    const quick = screen.getByRole('combobox', { name: CORE['orderCreate.items.quickSearch']! });

    // The same rules as the picker: refused options are shown, disabled, with the reason.
    await user.type(quick, 'widget');
    const paused = await screen.findByRole('option', { name: /Paused widget/ });
    expect(paused).toHaveAttribute('aria-disabled', 'true');
    expect(paused.textContent).toContain(CORE['productBrowser.reason.notActive']);
    // Feature 159 (N-31) — a product already a line is offered again.
    expect(screen.getByRole('option', { name: /Widget 01/ }).textContent).not.toContain('Already added');
    // The quick search includes archived products, and refuses an active one for
    // being archived (feature 163, FR-019).
    await user.clear(quick);
    await user.type(quick, 'retired');
    const retired = await screen.findByRole('option', { name: /Retired widget/ });
    expect(retired).toHaveAttribute('aria-disabled', 'true');
    expect(retired.textContent).toContain(CORE['productBrowser.reason.archived']);
    await user.clear(quick);

    await user.type(quick, 'SKU-A07');
    await user.click(await screen.findByRole('option', { name: /Widget 07/ }));

    // The line is added after the click settles; asserting at once raced the render.
    await waitFor(() => expect(lineNames()).toEqual(['Widget 01', 'Widget 07']));
    expect(within(lineRow('Widget 07')).getByText('SKU-A07')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(previewBodies().at(-1)?.items).toEqual([
        { productId: 'a01', quantity: 1 },
        { productId: 'a07', quantity: 1 },
      ]),
    );
  });

  it('renders each preview code as its own reason and blocks submit while other lines keep prices (sc. 6, 11–13)', async () => {
    unavailableCodes = {
      a01: 'PRODUCT_NOT_VISIBLE_TO_CUSTOMER',
      a02: 'PRODUCT_NOT_IN_SALES_CHANNEL',
      a03: 'PRODUCT_NOT_FOUND',
      a04: 'QUOTE_ONLY',
      a05: 'SOME_FUTURE_CODE',
    };
    const user = userEvent.setup();
    renderPage();
    await pickOption(user, 'paymentMethodId', 'Payment 1');
    await pickOption(user, 'deliveryMethodId', 'Delivery 1');
    await addThroughPicker(user, ['Widget 01', 'Widget 02', 'Widget 03', 'Widget 04', 'Widget 05', 'Widget 06']);

    await waitFor(() =>
      expect(within(lineRow('Widget 01')).getByText(CORE['orderCreate.line.notVisible']!)).toBeInTheDocument(),
    );
    expect(within(lineRow('Widget 02')).getByText(CORE['orderCreate.line.notInChannel']!)).toBeInTheDocument();
    for (const name of ['Widget 03', 'Widget 04', 'Widget 05']) {
      expect(within(lineRow(name)).getByText('No price')).toBeInTheDocument();
    }
    expect(within(lineRow('Widget 01')).queryByText('No price')).toBeNull();
    expect(within(lineRow('Widget 02')).queryByText(CORE['orderCreate.line.notVisible']!)).toBeNull();
    expect(within(lineRow('Widget 06')).getAllByText(money(10))).toHaveLength(2);
    expect(submitButton()).toBeDisabled();

    // Removing the unavailable lines unblocks it.
    for (const name of ['Widget 01', 'Widget 02', 'Widget 03', 'Widget 04', 'Widget 05']) {
      await user.click(within(lineRow(name)).getByRole('button', { name: `Delete ${name}` }));
    }
    expect(lineNames()).toEqual(['Widget 06']);
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it.each(['0', 'abc'])(
    'marks a line with quantity %s, leaves it out of the preview and blocks submit',
    async (bad) => {
      const user = userEvent.setup();
      renderPage();
      await pickOption(user, 'paymentMethodId', 'Payment 1');
      await pickOption(user, 'deliveryMethodId', 'Delivery 1');
      await addThroughPicker(user, ['Widget 01', 'Widget 02']);
      await waitFor(() => expect(submitButton()).toBeEnabled());

      const qty = screen.getByRole('textbox', { name: 'Quantity Widget 01' });
      await user.clear(qty);
      await user.type(qty, bad);

      expect(within(lineRow('Widget 01')).getByText(CORE['orderCreate.line.quantityInvalid']!)).toBeInTheDocument();
      expect(qty).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(previewBodies().at(-1)?.items).toEqual([{ productId: 'a02', quantity: 1 }]));
      expect(submitButton()).toBeDisabled();
    },
  );

  it('shows "Could not calculate prices" for a refused preview, marks no line and keeps every line (sc. 14)', async () => {
    postSpy.mockImplementation((path: string) => {
      if (path.endsWith('/orders/preview')) {
        return Promise.reject(
          new ApiError(404, { error: { code: 'NOT_FOUND', message: 'Sales channel not found' } } as never),
        );
      }
      return Promise.resolve({ data: { id: 'new-order-1' } });
    });
    const user = userEvent.setup();
    renderPage();
    await addThroughPicker(user, ['Widget 01', 'Widget 02']);

    expect(await screen.findByText(CORE['orderCreate.preview.error']!)).toBeInTheDocument();
    expect(lineNames()).toEqual(['Widget 01', 'Widget 02']);
    for (const key of ['orderCreate.line.unavailable', 'orderCreate.line.notVisible', 'orderCreate.line.notInChannel']) {
      expect(screen.queryByText(CORE[key]!)).toBeNull();
    }
    expect(screen.queryByText(CORE['orderCreate.summary.title']!)).toBeNull();
  });

  it('creates the order with exactly the visible lines and quantities (FR-026)', async () => {
    const user = userEvent.setup();
    renderPage();
    await pickOption(user, 'paymentMethodId', 'Payment 1');
    await pickOption(user, 'deliveryMethodId', 'Delivery 1');
    await addThroughPicker(user, ['Widget 01', 'Widget 02', 'Widget 03']);
    await user.click(within(lineRow('Widget 02')).getByRole('button', { name: 'Delete Widget 02' }));
    const qty = screen.getByRole('textbox', { name: 'Quantity Widget 03' });
    await user.clear(qty);
    await user.type(qty, '4');

    await waitFor(() => expect(previewBodies().at(-1)?.items).toHaveLength(2));
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    expect(postSpy).toHaveBeenCalledWith(
      '/api/v1/admin/orders',
      expect.objectContaining({
        items: [
          { productId: 'a01', quantity: 1 },
          { productId: 'a03', quantity: 4 },
        ],
      }),
    );
  });
});
