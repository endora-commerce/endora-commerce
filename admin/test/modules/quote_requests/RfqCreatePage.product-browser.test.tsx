import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminMe } from '@endora-commerce/admin-kit/lib';
import { ADMIN_PREFERENCES_DEFAULTS } from '@endora-commerce/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { ORGANIZATION_CHANNEL_ID, organizationSalesChannelsAnswer } from '../../helpers/organization-sales-channels';

/**
 * Feature 145, User Story 3 (FR-030…FR-036, research R-11): on **Create quote
 * request**, lines are added through **Browse products** (the shared picker, many
 * at once) or the quick search beside it, each with an editable quantity and an
 * agreed unit price prefilled from the customer's price lists. A hand-typed price
 * is never overwritten; an empty price or an invalid quantity marks the line and
 * blocks submit instead of the line being dropped from the request.
 *
 * **The bundle is `_i18n`'s shipped English one, read off disk** (as the order
 * screen's test does), so a missing key fails here instead of passing as its name.
 *
 * **The server is a small fake**: the catalogue list filters, counts and paginates
 * what the picker asks for; the price explanation (`POST …/price-books/resolve`) answers per product, customer and
 * quantity, with a few products resolving to nothing.
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

const { RfqCreatePage } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqCreatePage');

// ---------------------------------------------------------------- bundle

const REPO_ROOT = resolve(process.cwd(), '..');
const CORE: Record<string, string> = JSON.parse(
  readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const BUNDLE: Bundle = { core: CORE };
const tr = (key: string): string => {
  const value = CORE[key];
  if (value === undefined) throw new Error(`missing core key ${key}`);
  return value;
};

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
  product('b1', 'Starter bundle', 'active', 'bundle'),
  product('p1', 'Paused widget', 'inactive'),
  product('i1', 'Old widget', 'inactive'),
  ...Array.from({ length: 24 }, (_, i) => product(`a${pad(i + 1)}`, `Widget ${pad(i + 1)}`)),
  product('x1', 'Retired widget', 'active', 'simple', '2026-10-20T00:00:00.000Z'),
];

const LIST_PATH = '/api/v1/admin/catalog/products';

function serveCatalog(url: string): unknown {
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
  const matches = CATALOG.filter(
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

// ---------------------------------------------------------------- fake price resolution

const ORG_1 = '00000000-0000-4000-8000-0000000000a1';
const ORG_2 = '00000000-0000-4000-8000-0000000000a2';
const ORG_3 = '00000000-0000-4000-8000-0000000000a3';
const CUSTOMERS = [
  { id: 'cust-1', email: 'jan@acme.test', firstName: 'Jan', lastName: 'Kowalski', organizationId: ORG_1, organizationName: 'Acme' },
  { id: 'cust-2', email: 'anna@beta.test', firstName: 'Anna', lastName: 'Nowak', organizationId: ORG_2, organizationName: 'Beta' },
  { id: 'cust-3', email: 'ewa@gamma.test', firstName: 'Ewa', lastName: 'Zielinska', organizationId: ORG_3, organizationName: 'Gamma' },
  { id: 'cust-4', email: 'solo@home.test', firstName: 'Solo', lastName: 'Buyer', organizationId: null, organizationName: null },
];

/** Products no price list prices. */
const NO_PRICE = new Set(['a03', 'a07']);

/**
 * cust-1 pays 10.00, cust-2 pays 20.00, and from quantity 5 one less; nothing
 * resolves for cust-3.
 */
function priceFor(productId: string, customerId: string, quantity: number): string | null {
  if (NO_PRICE.has(productId) || customerId === 'cust-3') return null;
  const base = customerId === 'cust-2' ? 20 : 10;
  return (quantity >= 5 ? base - 1 : base).toFixed(2);
}

/** Products whose resolution is held until the test releases it. */
let held = new Map<string, () => void>();
let holdNext: Set<string> = new Set();

interface ResolveCall {
  productId: string;
  organizationId: string | null;
  customerAccountId: string | null;
  quantity: number;
}

function resolveCalls(): ResolveCall[] {
  return postSpy.mock.calls
    .filter(([path]) => path === '/api/v1/admin/price-books/resolve')
    .map(([, body]) => {
      const request = body as {
        buyer: { organizationId?: string; customerAccountId?: string };
        lines: Array<{ productId: string; quantity: number }>;
      };
      return {
        productId: request.lines[0]?.productId ?? '',
        organizationId: request.buyer.organizationId ?? null,
        customerAccountId: request.buyer.customerAccountId ?? null,
        quantity: request.lines[0]?.quantity ?? 0,
      };
    });
}

// ---------------------------------------------------------------- rig

const SESSION = adminSession({ permissions: ['*'] });
/**
 * The page size the Product list and this picker share (`catalog-products`),
 * seeded on the session as the server would send it (feature 164 moved it off
 * `localStorage`).
 */
let catalogPageSize = 20;
const sessionWithPageSize = (): AdminMe => ({
  ...SESSION,
  preferences: { ...ADMIN_PREFERENCES_DEFAULTS, listPageSizes: { 'catalog-products': catalogPageSize } },
});
/** The kit's own client, which the preferences store writes through. */
const kitClient = (
  await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')
).apiClient;

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  held = new Map();
  holdNext = new Set();
  catalogPageSize = 20;
  vi.spyOn(kitClient, 'patch').mockResolvedValue({ data: ADMIN_PREFERENCES_DEFAULTS });
  getSpy.mockImplementation((path: string) => {
    const channels = organizationSalesChannelsAnswer(path);
    if (channels) return channels;
    const one = CUSTOMERS.find((c) => path === `/api/v1/admin/customers/${c.id}`);
    if (one) return Promise.resolve({ data: one });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: CUSTOMERS });
    if (path.startsWith(`${LIST_PATH}?`)) return Promise.resolve(serveCatalog(path));
    if (path.startsWith(`${LIST_PATH}/`)) {
      const row = CATALOG.find((p) => p.id === path.slice(LIST_PATH.length + 1));
      return row ? Promise.resolve({ data: row }) : Promise.reject(new Error('not found'));
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string, request: { buyer: { customerAccountId?: string }; lines: Array<{ key: string; productId: string; quantity: number }> }) => {
    if (path !== '/api/v1/admin/price-books/resolve') return Promise.resolve({ data: { id: 'new-rfq-1' } });
    const line = request.lines[0]!;
    const amount = priceFor(line.productId, request.buyer.customerAccountId ?? '', line.quantity);
    const body = { data: [{ key: line.key, price: amount === null ? null : { amount, currency: 'PLN', source: 'buyer' } }] };
    if (holdNext.has(line.productId)) {
      holdNext.delete(line.productId);
      return new Promise((resolveHeld) => held.set(line.productId, () => resolveHeld(body)));
    }
    return Promise.resolve(body);
  });
});

/** Opened with cust-1 chosen unless `customer` says otherwise (`null` = none). */
function renderPage(customer: string | null = 'cust-1'): void {
  // <StrictMode>, as the admin renders (admin-shell's AdminRoot): its dev
  // double-mount is what an effect cleared only in cleanup does not survive.
  renderWithI18n(
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={[`/quote-requests/new${customer ? `?customerAccountId=${customer}` : ''}`]}>
          <RfqCreatePage />
        </MemoryRouter>,
        { session: sessionWithPageSize(), presence: modulePresence({ present: ['quote_requests'] }) },
      )}
    </StrictMode>,
    BUNDLE,
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function waitForCustomer(name: string): Promise<void> {
  await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue(name));
}

async function chooseCustomer(user: User, name: string): Promise<void> {
  const input = screen.getByLabelText('customerAccountId');
  await user.click(input);
  await user.clear(input);
  await user.type(input, name.split(' ')[0]!);
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
  await waitForCustomer(name);
}

async function openPicker(user: User): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: tr('productBrowser.trigger') }));
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

function lineRow(name: string): HTMLElement {
  const row = screen.getByText(name, { selector: '[data-line-name]' }).closest('tr');
  if (!row) throw new Error(`no line row for ${name}`);
  return row as HTMLElement;
}

function lineNames(): string[] {
  return Array.from(document.querySelectorAll('[data-line-name]')).map((el) => el.textContent ?? '');
}

const qtyInput = (name: string): HTMLInputElement =>
  screen.getByRole('textbox', { name: `${tr('rfqCreate.field.quantity')} ${name}` }) as HTMLInputElement;
const priceInput = (name: string): HTMLInputElement =>
  screen.getByRole('spinbutton', { name: `${tr('rfqCreate.field.agreedUnitPrice')} ${name}` }) as HTMLInputElement;

const submitButton = (): HTMLElement => screen.getByRole('button', { name: tr('rfqCreate.submit') });
const totalText = (amount: string): string => `${tr('rfqCreate.total')}: ${amount}`;

async function retype(user: User, input: HTMLElement, value: string): Promise<void> {
  await user.clear(input);
  if (value !== '') await user.type(input, value);
}

const WIDGETS_1_TO_10 = Array.from({ length: 10 }, (_, i) => `Widget ${pad(i + 1)}`);

// ---------------------------------------------------------------- cases

describe('RfqCreatePage — Browse products and the quick search (US3)', () => {
  it('starts with no lines and an empty state, and has no per-row product search', async () => {
    renderPage();
    expect(screen.getByText(tr('rfqCreate.items.empty'))).toBeInTheDocument();
    expect(screen.queryByLabelText('product-0')).toBeNull();
    expect(screen.getByRole('button', { name: tr('productBrowser.trigger') })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: tr('rfqCreate.items.quickSearch') })).toBeInTheDocument();
    await waitForCustomer('Jan Kowalski');
    expect(submitButton()).toBeDisabled();
  });

  it('opens on Active with the quote-request rules: inactive selectable, grouped and bundle not (sc. 1, 7)', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openPicker(user);

    expect(within(dialog).getByRole('tab', { name: /^Active/ }).getAttribute('aria-selected')).toBe('true');
    expect(within(dialog).getByRole('heading', { name: tr('rfqCreate.items.browse') })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('tab', { name: /^All/ }));
    await waitFor(() => expect(within(dialog).getByText('Grouped set')).toBeInTheDocument());
    for (const name of ['Grouped set', 'Starter bundle']) {
      const box = rowCheckbox(dialog, name);
      expect(box.disabled).toBe(true);
      expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
        tr('productBrowser.reason.groupParent'),
      );
    }
    expect(rowCheckbox(dialog, 'Paused widget').disabled).toBe(false);
    expect(rowCheckbox(dialog, 'Old widget').disabled).toBe(false);

    await user.click(rowCheckbox(dialog, 'Paused widget'));
    await user.click(rowCheckbox(dialog, 'Old widget'));
    await user.click(within(dialog).getByRole('button', { name: 'Add 2' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(lineNames()).toEqual(['Paused widget', 'Old widget']);
  });

  // Owner decision P-3 → A (2026-10-26): a quote request refuses archived products, as an
  // order does. This case asserted the opposite until then.
  it('offers no Archived tab, and All leaves archived products out (feature 163, P-3)', async () => {
    const user = userEvent.setup();
    renderPage();
    const dialog = await openPicker(user);
    expect(within(dialog).queryByRole('tab', { name: /^Archived/ })).toBeNull();
    await user.click(within(dialog).getByRole('tab', { name: /^All/ }));
    await waitFor(() => expect(within(dialog).getByText('Paused widget')).toBeInTheDocument());
    expect(within(dialog).queryByText('Retired widget')).toBeNull();
    expect(getSpy.mock.calls.some(([p]) => /archived=only|includeArchived/.test(String(p)))).toBe(false);
  });

  // Owner decision RFQ-c → B (2026-10-26): the quick search behaves as the order's — it
  // lists archived products, refused with the reason, rather than hiding them.
  it('the quick search lists an archived product, refused with the reason (feature 163, P-3, RFQ-c)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    const quick = screen.getByRole('combobox', { name: tr('rfqCreate.items.quickSearch') });
    await user.type(quick, 'retired');
    const retired = await screen.findByRole('option', { name: /Retired widget/ });
    expect(retired).toHaveAttribute('aria-disabled', 'true');
    expect(retired.textContent).toContain(tr('productBrowser.reason.archived'));
    expect(getSpy.mock.calls.some(([p]) => String(p).includes('includeArchived=1'))).toBe(true);
  });

  it('adds 10 lines with quantity 1 and prefills the prices that resolve, leaving the rest empty (sc. 2, FR-031)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, WIDGETS_1_TO_10);

    expect(lineNames()).toEqual(WIDGETS_1_TO_10);
    expect(within(lineRow('Widget 04')).getByText('SKU-A04')).toBeInTheDocument();
    for (const name of WIDGETS_1_TO_10) expect(qtyInput(name)).toHaveValue('1');

    await waitFor(() => expect(priceInput('Widget 10')).toHaveValue(10));
    for (const name of WIDGETS_1_TO_10) {
      expect(priceInput(name)).toHaveValue(name === 'Widget 03' || name === 'Widget 07' ? null : 10);
    }
    const calls = resolveCalls();
    expect(calls).toHaveLength(10);
    expect(calls[0]).toEqual({ productId: 'a01', organizationId: ORG_1, customerAccountId: 'cust-1', quantity: 1 });
    // Eight priced lines of 10.00 at quantity 1.
    expect(screen.getByText(totalText('80.00'))).toBeInTheDocument();
  });

  it('re-prefills a line on a quantity change only while its price was not typed by hand (sc. 3, FR-033)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 01', 'Widget 02']);
    await waitFor(() => expect(priceInput('Widget 02')).toHaveValue(10));

    await retype(user, priceInput('Widget 02'), '15');
    await retype(user, qtyInput('Widget 01'), '5');
    await retype(user, qtyInput('Widget 02'), '5');

    await waitFor(() => expect(priceInput('Widget 01')).toHaveValue(9));
    expect(resolveCalls().filter((c) => c.productId === 'a01').map((c) => c.quantity)).toContain(5);
    // The hand-typed price is not re-resolved, and not overwritten.
    expect(resolveCalls().filter((c) => c.productId === 'a02').map((c) => c.quantity)).toEqual([1]);
    expect(priceInput('Widget 02')).toHaveValue(15);
  });

  it('clears a prefilled price when its quantity becomes invalid, and resolves it again once the quantity is valid (FR-033, FR-034)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 01', 'Widget 02']);
    await waitFor(() => expect(priceInput('Widget 02')).toHaveValue(10));
    await retype(user, priceInput('Widget 02'), '15');

    // A resolved price is the answer for a quantity; with no valid quantity it is no
    // one's answer, so it is not left on screen as if it were.
    await retype(user, qtyInput('Widget 01'), '0');
    expect(priceInput('Widget 01')).toHaveValue(null);
    expect(within(lineRow('Widget 01')).getByText(tr('rfqCreate.line.quantityInvalid'))).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    // A hand-typed price is the operator's and stays.
    await retype(user, qtyInput('Widget 02'), '');
    expect(priceInput('Widget 02')).toHaveValue(15);

    await retype(user, qtyInput('Widget 01'), '5');
    await waitFor(() => expect(priceInput('Widget 01')).toHaveValue(9));
  });

  it('appends an add once, and prefills only its lines, when two confirms land in the same tick', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    const dialog = await openPicker(user);
    await user.click(rowCheckbox(dialog, 'Widget 01'));
    await user.click(rowCheckbox(dialog, 'Widget 02'));
    const add = within(dialog).getByRole('button', { name: 'Add 2' });
    // Both clicks reach the same, not yet re-rendered handlers.
    act(() => {
      add.click();
      add.click();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(priceInput('Widget 02')).toHaveValue(10));

    expect(lineNames()).toEqual(['Widget 01', 'Widget 02']);
    expect(resolveCalls().map((c) => c.productId)).toEqual(['a01', 'a02']);
  });

  it('keeps a price typed while its prefill is still in flight', async () => {
    holdNext.add('a01');
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 01']);
    await waitFor(() => expect(held.has('a01')).toBe(true));

    await retype(user, priceInput('Widget 01'), '12.5');
    held.get('a01')!();
    await waitFor(() => expect(resolveCalls()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(priceInput('Widget 01')).toHaveValue(12.5);
  });

  it('updates the running total on every price and quantity edit (sc. 4, FR-035)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 01', 'Widget 02']);
    await waitFor(() => expect(screen.getByText(totalText('20.00'))).toBeInTheDocument());

    await retype(user, priceInput('Widget 02'), '7.5');
    expect(screen.getByText(totalText('17.50'))).toBeInTheDocument();
    await retype(user, qtyInput('Widget 02'), '3');
    expect(screen.getByText(totalText('32.50'))).toBeInTheDocument();
  });

  it('marks a line with no price and blocks submit, then sends every line once it is priced (sc. 5, FR-034)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 01', 'Widget 02', 'Widget 03']);
    await waitFor(() => expect(priceInput('Widget 02')).toHaveValue(10));

    expect(within(lineRow('Widget 03')).getByText(tr('rfqCreate.line.priceMissing'))).toBeInTheDocument();
    expect(priceInput('Widget 03')).toHaveAttribute('aria-invalid', 'true');
    expect(within(lineRow('Widget 01')).queryByText(tr('rfqCreate.line.priceMissing'))).toBeNull();
    expect(submitButton()).toBeDisabled();

    await retype(user, priceInput('Widget 03'), '4.25');
    expect(within(lineRow('Widget 03')).queryByText(tr('rfqCreate.line.priceMissing'))).toBeNull();
    await retype(user, qtyInput('Widget 01'), '2');
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/quote-requests', {
      organizationId: ORG_1,
      customerAccountId: 'cust-1',
      salesChannelId: ORGANIZATION_CHANNEL_ID,
      items: [
        { productId: 'a01', quantity: 2, agreedUnitPrice: 10 },
        { productId: 'a02', quantity: 1, agreedUnitPrice: 10 },
        { productId: 'a03', quantity: 1, agreedUnitPrice: 4.25 },
      ],
    });
  });

  it('accepts an agreed price of 0', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 03']);
    await retype(user, priceInput('Widget 03'), '0');
    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it.each(['0', 'abc', '1.5'])('marks a line with quantity %s and blocks submit, keeping the line', async (bad) => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 01', 'Widget 02']);
    await waitFor(() => expect(submitButton()).toBeEnabled());

    await retype(user, qtyInput('Widget 01'), bad);

    expect(within(lineRow('Widget 01')).getByText(tr('rfqCreate.line.quantityInvalid'))).toBeInTheDocument();
    expect(qtyInput('Widget 01')).toHaveAttribute('aria-invalid', 'true');
    expect(lineNames()).toEqual(['Widget 01', 'Widget 02']);
    expect(submitButton()).toBeDisabled();
    // Only the valid line counts towards the total.
    expect(screen.getByText(totalText('10.00'))).toBeInTheDocument();
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
  });

  it('adds lines before a customer with empty prices, and prefills them once a customer with an organization is chosen (FR-032)', async () => {
    const user = userEvent.setup();
    renderPage(null);
    await addThroughPicker(user, ['Widget 01', 'Widget 02']);

    expect(priceInput('Widget 01')).toHaveValue(null);
    expect(resolveCalls()).toEqual([]);

    await chooseCustomer(user, 'Jan Kowalski');
    await waitFor(() => expect(priceInput('Widget 01')).toHaveValue(10));
    expect(priceInput('Widget 02')).toHaveValue(10);
  });

  it('clears and re-resolves every price not typed by hand when the customer changes (research R-11)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 01', 'Widget 02', 'Widget 03']);
    await waitFor(() => expect(priceInput('Widget 01')).toHaveValue(10));
    await retype(user, priceInput('Widget 02'), '15');

    await chooseCustomer(user, 'Anna Nowak');
    await waitFor(() => expect(priceInput('Widget 01')).toHaveValue(20));
    expect(priceInput('Widget 02')).toHaveValue(15);
    expect(priceInput('Widget 03')).toHaveValue(null);
    // Once per line not typed by hand, on the new customer's channel once it is
    // read — never first without a channel (feature 163, owner decision 2026-10-29 "A").
    expect(resolveCalls().filter((c) => c.customerAccountId === 'cust-2').map((c) => c.productId).sort()).toEqual([
      'a01',
      'a03',
    ]);

    // A customer for whom nothing resolves: the previous customer's price does not survive.
    await chooseCustomer(user, 'Ewa Zielinska');
    await waitFor(() => expect(resolveCalls().filter((c) => c.customerAccountId === 'cust-3')).toHaveLength(2));
    await waitFor(() => expect(priceInput('Widget 01')).toHaveValue(null));
    expect(priceInput('Widget 02')).toHaveValue(15);
    expect(within(lineRow('Widget 01')).getByText(tr('rfqCreate.line.priceMissing'))).toBeInTheDocument();
  });

  it('keeps the customer-without-organization warning and blocks submit (FR-036)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 01']);
    await waitFor(() => expect(submitButton()).toBeEnabled());

    await chooseCustomer(user, 'Solo Buyer');
    expect(screen.getByText(tr('rfqCreate.noOrgWarning'))).toBeInTheDocument();
    // The price belonged to the previous customer.
    expect(priceInput('Widget 01')).toHaveValue(null);
    expect(submitButton()).toBeDisabled();
    expect(resolveCalls().some((c) => c.customerAccountId === 'cust-4')).toBe(false);
  });

  it('appends one line from the quick search under the same rules (FR-030)', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCustomer('Jan Kowalski');
    await addThroughPicker(user, ['Widget 01']);
    const quick = screen.getByRole('combobox', { name: tr('rfqCreate.items.quickSearch') });

    await user.type(quick, 'widget');
    const paused = await screen.findByRole('option', { name: /Paused widget/ });
    expect(paused).not.toHaveAttribute('aria-disabled', 'true');
    // Feature 159 (N-31) — a product already a line is offered again.
    expect(screen.getByRole('option', { name: /Widget 01/ }).textContent).not.toContain(
      tr('productBrowser.reason.alreadyAdded'),
    );
    await user.clear(quick);

    await user.type(quick, 'grouped');
    const grouped = await screen.findByRole('option', { name: /Grouped set/ });
    expect(grouped).toHaveAttribute('aria-disabled', 'true');
    await user.clear(quick);

    await user.type(quick, 'SKU-A07');
    await user.click(await screen.findByRole('option', { name: /Widget 07/ }));

    // The line is added after the click settles; asserting at once raced the render.
    await waitFor(() => expect(lineNames()).toEqual(['Widget 01', 'Widget 07']));
    expect(within(lineRow('Widget 07')).getByText('SKU-A07')).toBeInTheDocument();
    expect(qtyInput('Widget 07')).toHaveValue('1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
