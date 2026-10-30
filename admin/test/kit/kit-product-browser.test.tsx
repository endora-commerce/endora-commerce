import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminMe } from '@endora-commerce/admin-kit/lib';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StrictMode, useState, type ReactElement, type ReactNode } from 'react';
import { ADMIN_PREFERENCES_DEFAULTS, ADMIN_PRODUCT_SELECTION_MAX } from '@endora-commerce/contracts';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { adminSession } from '../helpers/render-with-session';

/**
 * The shared product browser (feature 145, contract
 * `specs/145-admin-product-picker/contracts/product-browser-component.md`, B1–B14).
 *
 * Two choices carry the weight of this file.
 *
 * **The bundle is `_i18n`'s shipped one, read off disk**, in English and in
 * Polish — as `kit-core-namespace.test.tsx` does — because a passthrough bundle
 * renders the key as its own value and so passes for a key that does not exist.
 *
 * **The server is a small fake catalogue**, not a canned response per call: the
 * mock reads the query string the picker built, filters, counts and paginates.
 * A test that asserts a request *and* what the screen shows for it then proves
 * the two agree, which a fixed response cannot.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ProductBrowserDialog, ProductBrowserTrigger } = await import(
  '@endora-commerce/admin-kit/components'
);
const { AuthProvider } = await import('@endora-commerce/admin-kit/lib');
type Rules = import('@endora-commerce/admin-kit/components').ProductBrowserRules;
type Item = import('@endora-commerce/admin-kit/components').ProductBrowserItem;

// ---------------------------------------------------------------- bundles

const REPO_ROOT = resolve(process.cwd(), '..');

function coreBundle(language: 'en' | 'pl'): Bundle {
  const raw = readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`), 'utf8');
  return { core: JSON.parse(raw) as Record<string, string> };
}
const BUNDLES = { en: coreBundle('en'), pl: coreBundle('pl') };

function expectNoRawKeys(container: HTMLElement): void {
  expect(container.innerHTML).not.toMatch(/\bcore\.[a-zA-Z]/);
}

// ---------------------------------------------------------------- fake catalogue

interface Row extends Item {
  updatedAt: string;
}

function product(
  id: string,
  en: string,
  status: Item['status'],
  type: Item['type'],
  pl?: string,
  archivedAt: string | null = null,
): Row {
  return {
    id,
    sku: `SKU-${id.toUpperCase()}`,
    slug: id,
    name: pl ? { 'en-US': en, 'pl-PL': pl } : { 'en-US': en },
    status,
    type,
    archivedAt,
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * g1 (active, grouped), p1 and i1 (inactive), then a01…a24 — 27 rows that are not
 * archived, 25 of them active — and x1, an **active** product that is archived
 * (feature 163: archived is its own axis, independent of status).
 */
const CATALOG: Row[] = [
  product('g1', 'Grouped set', 'active', 'grouped'),
  product('p1', 'Paused widget', 'inactive', 'simple'),
  product('i1', 'Old widget', 'inactive', 'simple'),
  ...Array.from({ length: 24 }, (_, i) =>
    i === 0
      ? product('a01', 'Widget 01', 'active', 'simple', 'Widżet 01')
      : product(`a${pad(i + 1)}`, `Widget ${pad(i + 1)}`, 'active', 'simple'),
  ),
  product('x1', 'Retired widget', 'active', 'simple', undefined, '2026-10-20T00:00:00.000Z'),
];

const PATH = '/api/v1/admin/catalog/products';

function serve(catalog: readonly Row[], url: string): unknown {
  const [path, query = ''] = url.split('?');
  expect(path).toBe(PATH);
  const params = new URLSearchParams(query);
  // Feature 163 (R30.4) — the list's own rules: archived products are excluded by
  // default, `archived=only` asks for them alone, and the legacy flag is not sent.
  expect(params.has('includeArchived')).toBe(false);
  const archivedMode = params.get('archived') ?? 'exclude';
  const status = params.get('status');
  const type = params.get('type');
  const q = (params.get('q') ?? '').toLowerCase();
  const page = Number(params.get('page'));
  const pageSize = Number(params.get('pageSize'));
  const matches = catalog.filter(
    (p) =>
      (type === null || p.type === type) &&
      (q === '' ||
        p.sku.toLowerCase().includes(q) ||
        p.slug.includes(q) ||
        Object.values(p.name).some((n) => n.toLowerCase().includes(q))),
  );
  const live = matches.filter((p) => p.archivedAt == null);
  const archived = matches.filter((p) => p.archivedAt != null);
  const base = archivedMode === 'only' ? archived : live;
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

function useCatalog(catalog: readonly Row[] = CATALOG): void {
  getSpy.mockImplementation(async (url: string) => serve(catalog, url));
}

function requestedUrls(): string[] {
  return getSpy.mock.calls.map((c) => c[0] as string);
}

// ---------------------------------------------------------------- harness

const ORDER_RULES: Rules = {
  initialStatus: 'active',
  blockedTypes: ['grouped', 'bundle'],
  blockedStatuses: ['inactive'],
  blockArchived: true,
};
const PRICE_LIST_RULES: Rules = { initialStatus: 'all' };

const SESSION = adminSession({ permissions: ['catalog:read'] });
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
let preferencesPatch: ReturnType<typeof vi.spyOn>;

interface HarnessProps {
  rules?: Rules;
  alreadyAddedIds?: string[];
  /** `sync` closes in `onConfirm`; `async` closes once the returned promise resolves. */
  mode?: 'sync' | 'async';
  onConfirm?: (items: Item[]) => void | Promise<void>;
  onCancel?: () => void;
  confirmErrorMessage?: (error: unknown) => string;
}

/** A host as the three screens will be: it owns `open`, the trigger and the close. */
function Harness(props: HarnessProps): ReactNode {
  const [open, setOpen] = useState(false);
  const onConfirm = props.onConfirm ?? ((): void => {});
  return (
    <>
      <ProductBrowserTrigger onOpen={(): void => setOpen(true)} />
      <ProductBrowserDialog
        open={open}
        title="Add products to the order"
        rules={props.rules ?? ORDER_RULES}
        alreadyAddedIds={props.alreadyAddedIds ?? []}
        onConfirm={
          props.mode === 'async'
            ? async (items: Item[]): Promise<void> => {
                await onConfirm(items);
                setOpen(false);
              }
            : (items: Item[]): void => {
                void onConfirm(items);
                setOpen(false);
              }
        }
        onCancel={(): void => {
          props.onCancel?.();
          setOpen(false);
        }}
        {...(props.confirmErrorMessage ? { confirmErrorMessage: props.confirmErrorMessage } : {})}
      />
    </>
  );
}

function renderHarness(
  ui: ReactElement,
  options: { language?: 'en' | 'pl'; permissions?: readonly string[]; strict?: boolean } = {},
): ReturnType<typeof render> {
  const language = options.language ?? 'en';
  const session = options.permissions ? adminSession({ permissions: options.permissions }) : sessionWithPageSize();
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => {
    const tree = (
      <TranslationProvider language={language} initialBundle={BUNDLES[language]}>
        <AuthProvider initial={session}>
          <>{children}</>
        </AuthProvider>
      </TranslationProvider>
    );
    // The admin renders inside <StrictMode> (admin-shell's AdminRoot), whose dev
    // double-mount runs every effect's cleanup once before its setup runs again.
    return options.strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  return render(ui, { wrapper });
}

async function openPicker(user: ReturnType<typeof userEvent.setup>, label = 'Browse products'): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: label }));
  const dialog = await screen.findByRole('dialog');
  // The table region carries `aria-busy` while a page is being fetched.
  await waitFor(() => expect(dialog.querySelector('[aria-busy="true"]')).toBeNull());
  return dialog;
}

function rowCheckbox(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: `Select ${name}` }) as HTMLInputElement;
}

beforeEach(() => {
  getSpy.mockReset();
  catalogPageSize = 10;
  preferencesPatch = vi.spyOn(kitClient, 'patch').mockResolvedValue({ data: ADMIN_PREFERENCES_DEFAULTS });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------- B1, B2, B4

describe('requests and filters (B1, B2)', () => {
  it('opens on rules.initialStatus, leaving archived products out, with the preference page size', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness />);
    await openPicker(user);

    expect(requestedUrls()[0]).toBe(`${PATH}?page=0&pageSize=10&status=active`);
    const active = screen.getByRole('tab', { name: /^Active/ });
    expect(active.getAttribute('aria-selected')).toBe('true');
    // Counts come from the response's `counts`.
    expect(within(active).getByText('25')).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /^All/ })).getByText('27')).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /^Inactive/ })).getByText('2')).toBeTruthy();
    // Feature 163 — no Draft tab anywhere; a host that refuses archived products
    // (the order) is not offered a tab of rows it could not tick.
    expect(screen.queryByRole('tab', { name: /^Draft/ })).toBeNull();
    expect(screen.queryByRole('tab', { name: /^Archived/ })).toBeNull();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['All27', 'Active25', 'Inactive2']);
    expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe('Search SKU, slug, name…');
  });

  it('opens on All for a host that asks for it, and the other tabs stay reachable', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness rules={PRICE_LIST_RULES} />);
    await openPicker(user);
    expect(requestedUrls()[0]).toBe(`${PATH}?page=0&pageSize=10`);

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'All27',
      'Active25',
      'Inactive2',
      'Archived1',
    ]);
    expect(screen.queryByText('Retired widget')).toBeNull();

    await user.click(screen.getByRole('tab', { name: /^Inactive/ }));
    await waitFor(() => expect(screen.getByText('Paused widget')).toBeTruthy());
    expect(requestedUrls().at(-1)).toBe(`${PATH}?page=0&pageSize=10&status=inactive`);

    // Archived is its own axis: `archived=only`, never a status value.
    await user.click(screen.getByRole('tab', { name: /^Archived/ }));
    await waitFor(() => expect(screen.getByText('Retired widget')).toBeTruthy());
    expect(requestedUrls().at(-1)).toBe(`${PATH}?archived=only&page=0&pageSize=10`);
    const row = screen.getByText('Retired widget').closest('tr')!;
    expect(within(row).getByText('Active')).toBeTruthy();
    // One Archived look across the browser, the list and the editor.
    expect(within(row).getByText('Archived')).toHaveClass('b2b-badge', 'b2b-badge--warn');
    // Not blocked by this host, so it can be ticked.
    expect(rowCheckbox('Retired widget').disabled).toBe(false);
  });

  it('cycles the type filter through every type and back to all', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness rules={PRICE_LIST_RULES} />);
    await openPicker(user);

    await user.click(screen.getByRole('button', { name: 'Type' }));
    await waitFor(() =>
      expect(requestedUrls().at(-1)).toBe(`${PATH}?page=0&pageSize=10&type=simple`),
    );
    expect(screen.getByRole('button', { name: 'Type: Simple' })).toBeTruthy();
    for (const label of ['Configurable', 'Grouped', 'Bundle', 'Virtual']) {
      await user.click(screen.getByRole('button', { name: /^Type: / }));
      expect(screen.getByRole('button', { name: `Type: ${label}` })).toBeTruthy();
    }
    await user.click(screen.getByRole('button', { name: /^Type: / }));
    // Unset, the chip reads as the Products list's does.
    expect(screen.getByRole('button', { name: 'Type' })).toBeTruthy();
    await waitFor(() =>
      expect(requestedUrls().at(-1)).toBe(`${PATH}?page=0&pageSize=10`),
    );
  });

  it('debounces the search and sends only the settled query', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness />);
    await openPicker(user);

    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'w' } });
    fireEvent.change(search, { target: { value: 'wi' } });
    fireEvent.change(search, { target: { value: 'widget 0' } });

    await waitFor(() =>
      expect(requestedUrls().at(-1)).toBe(
        `${PATH}?page=0&pageSize=10&status=active&q=widget+0`,
      ),
    );
    const withQuery = requestedUrls().filter((u) => u.includes('q='));
    expect(withQuery).toHaveLength(1);
  });

  it('discards a stale response that arrives after a newer one', async () => {
    const pending: Array<{ url: string; resolve: () => void }> = [];
    getSpy.mockImplementation(
      (url: string) =>
        new Promise((done) => {
          pending.push({ url, resolve: (): void => done(serve(CATALOG, url)) });
        }),
    );
    const user = userEvent.setup();
    renderHarness(<Harness rules={PRICE_LIST_RULES} />);
    await user.click(screen.getByRole('button', { name: 'Browse products' }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(pending).toHaveLength(1));

    await user.click(screen.getByRole('tab', { name: /^Archived/ }));
    await waitFor(() => expect(pending).toHaveLength(2));

    pending[1]!.resolve(); // the newer (archived) answer first
    await waitFor(() => expect(screen.getByText('Retired widget')).toBeTruthy());
    pending[0]!.resolve(); // the stale "all" answer last
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Grouped set')).toBeNull();
    expect(screen.getByText('Retired widget')).toBeTruthy();
  });
});

// ---------------------------------------------------------------- B3, B14

describe('columns (B3, B14)', () => {
  it('shows product with the pl second line, SKU, translated status and type, in a scroll container', async () => {
    useCatalog();
    const user = userEvent.setup();
    const { container } = renderHarness(<Harness />);
    const dialog = await openPicker(user);

    for (const header of ['Product', 'SKU', 'Status', 'Type']) {
      expect(within(dialog).getByRole('columnheader', { name: header })).toBeTruthy();
    }
    const row = screen.getByText('Widget 01').closest('tr')!;
    expect(within(row).getByText('Widżet 01')).toBeTruthy();
    expect(within(row).getByText('SKU-A01')).toBeTruthy();
    expect(within(row).getByText('Active')).toBeTruthy();
    expect(within(row).getByText('Simple')).toBeTruthy();
    // A product with no different Polish name has no second line.
    const plain = screen.getByText('Widget 02').closest('tr')!;
    expect(within(plain).getAllByText(/Widget 02|Widżet 02/)).toHaveLength(1);
    expect(dialog.querySelector('.b2b-table-scroll table')).not.toBeNull();
    expectNoRawKeys(container);
  });

  it('renders in Polish from the shipped bundle', async () => {
    useCatalog();
    const user = userEvent.setup();
    const { container } = renderHarness(<Harness />, { language: 'pl' });
    const dialog = await openPicker(user, 'Przeglądaj produkty');

    expect(within(dialog).getByRole('columnheader', { name: 'Produkt' })).toBeTruthy();
    expect(within(dialog).getByRole('tab', { name: /^Aktywne/ })).toBeTruthy();
    expect(within(screen.getByText('Widget 01').closest('tr')!).getByText('Aktywny')).toBeTruthy();
    expect(within(screen.getByText('Widget 01').closest('tr')!).getByText('Prosty')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Dodaj 0' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Zaznacz Widget 01' }));
    expect(within(dialog).getByRole('button', { name: 'Dodaj 1' })).toBeTruthy();
    expectNoRawKeys(container);
  });
});

// ---------------------------------------------------------------- B4, B5

describe('pagination and selection (B4, B5)', () => {
  it('a page-size change inside the picker leaves the Products list preference untouched', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness />);
    const dialog = await openPicker(user);

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() =>
      expect(requestedUrls().at(-1)).toBe(`${PATH}?page=1&pageSize=10&status=active`),
    );
    await user.selectOptions(within(dialog).getByRole('combobox'), '20');
    await waitFor(() =>
      expect(requestedUrls().at(-1)).toBe(`${PATH}?page=0&pageSize=20&status=active`),
    );
    expect(preferencesPatch).not.toHaveBeenCalled();
  });

  it('keeps the selection across page, page-size and filter changes', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness />);
    const dialog = await openPicker(user);

    await user.click(rowCheckbox('Widget 01'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByText('Widget 11')).toBeTruthy());
    await user.click(rowCheckbox('Widget 11'));
    await user.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(rowCheckbox('Widget 01').checked).toBe(true));

    await user.selectOptions(within(dialog).getByRole('combobox'), '50');
    await waitFor(() => expect(screen.getByText('Widget 24')).toBeTruthy());
    expect(rowCheckbox('Widget 11').checked).toBe(true);

    await user.click(screen.getByRole('tab', { name: /^All/ }));
    await waitFor(() => expect(screen.getByText('Grouped set')).toBeTruthy());
    expect(rowCheckbox('Widget 01').checked).toBe(true);
    expect(screen.getByText('2 selected')).toBeTruthy();
  });

  it('the header checkbox adds and removes only the selectable rows of the current page', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness rules={{ ...ORDER_RULES, initialStatus: 'all' }} />);
    await openPicker(user);

    // Page 0 of "All": g1 (grouped), p1 and i1 (inactive), a01…a07.
    await user.click(screen.getByRole('checkbox', { name: 'Select all selectable products on this page' }));
    expect(screen.getByText('7 selected')).toBeTruthy();
    expect(rowCheckbox('Grouped set').checked).toBe(false);
    expect(rowCheckbox('Paused widget').checked).toBe(false);

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByText('Widget 08')).toBeTruthy());
    expect(screen.getByText('7 selected')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Previous/ }));
    await waitFor(() => expect(screen.getByText('Widget 01')).toBeTruthy());
    await user.click(screen.getByRole('checkbox', { name: 'Select all selectable products on this page' }));
    expect(screen.getByText('0 selected')).toBeTruthy();
  });
});

// ---------------------------------------------------------------- B6, B7, B8

describe('footer, cap and reasons (B6, B7, B8)', () => {
  it('counts, clears and reviews the selection; Add N is disabled at 0', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness />);
    const dialog = await openPicker(user);

    const add0 = within(dialog).getByRole('button', { name: 'Add 0' }) as HTMLButtonElement;
    expect(add0.disabled).toBe(true);

    await user.click(rowCheckbox('Widget 03'));
    await user.click(rowCheckbox('Widget 05'));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Add 2' }) as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Show selected only' }));
    expect(screen.queryByText('Widget 01')).toBeNull();
    expect(screen.getByText('Widget 03')).toBeTruthy();
    expect(screen.getByText('Widget 05')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Show all products' }));
    await waitFor(() => expect(screen.getByText('Widget 01')).toBeTruthy());

    // Unticking the last selected row in that view returns to the full list.
    await user.click(screen.getByRole('button', { name: 'Show selected only' }));
    await user.click(rowCheckbox('Widget 03'));
    await user.click(rowCheckbox('Widget 05'));
    await waitFor(() => expect(screen.getByText('Widget 01')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Show selected only' })).toBeTruthy();
    await user.click(rowCheckbox('Widget 03'));

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('0 selected')).toBeTruthy();
    expect(rowCheckbox('Widget 03').checked).toBe(false);
  });

  it(`stops at ${ADMIN_PRODUCT_SELECTION_MAX}: further rows are disabled with a reason and a notice says why`, async () => {
    const big = Array.from({ length: ADMIN_PRODUCT_SELECTION_MAX + 5 }, (_, i) =>
      product(`b${String(i).padStart(3, '0')}`, `Bulk ${String(i).padStart(3, '0')}`, 'active', 'simple'),
    );
    useCatalog(big);
    catalogPageSize = 500;
    const user = userEvent.setup();
    renderHarness(<Harness rules={PRICE_LIST_RULES} />);
    await openPicker(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select all selectable products on this page' }));
    expect(screen.getByText(`${ADMIN_PRODUCT_SELECTION_MAX} selected`)).toBeTruthy();
    expect(
      screen.getByText(
        `You can add up to ${ADMIN_PRODUCT_SELECTION_MAX} products at a time. Add these, then open the picker again for more.`,
      ),
    ).toBeTruthy();
    const over = rowCheckbox(`Bulk ${ADMIN_PRODUCT_SELECTION_MAX}`);
    expect(over.disabled).toBe(true);
    const reason = document.getElementById(over.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe('Selection limit reached');
    // A selected row stays de-selectable at the cap.
    const first = rowCheckbox('Bulk 000');
    expect(first.disabled).toBe(false);
    await user.click(first);
    expect(screen.getByText(`${ADMIN_PRODUCT_SELECTION_MAX - 1} selected`)).toBeTruthy();
    expect(rowCheckbox(`Bulk ${ADMIN_PRODUCT_SELECTION_MAX}`).disabled).toBe(false);
  });

  it('renders non-selectable rows with a disabled checkbox and a visible, linked reason', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness rules={{ ...ORDER_RULES, initialStatus: 'all' }} alreadyAddedIds={['a02']} />);
    await openPicker(user);

    const cases: Array<[string, string]> = [
      ['Grouped set', 'Product group — pick its individual products'],
      ['Paused widget', 'Not active — cannot be added'],
      ['Old widget', 'Not active — cannot be added'],
      ['Widget 02', 'Already added'],
    ];
    for (const [name, text] of cases) {
      const box = rowCheckbox(name);
      expect(box.disabled).toBe(true);
      const described = document.getElementById(box.getAttribute('aria-describedby') ?? '');
      expect(described?.textContent).toBe(text);
    }
    expect(rowCheckbox('Widget 01').disabled).toBe(false);
  });

  it("uses the host's already-added label key when it passes one", async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(
      <Harness
        rules={{ initialStatus: 'all', alreadyAddedLabelKey: 'productBrowser.reason.limitReached' }}
        alreadyAddedIds={['a01']}
      />,
    );
    await openPicker(user);
    const box = rowCheckbox('Widget 01');
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Selection limit reached',
    );
  });
});

// ---------------------------------------------------------------- B9

describe('loading, empty and load-error states (B9)', () => {
  it('shows a loading state until the first answer', async () => {
    let release: (() => void) | undefined;
    getSpy.mockImplementation(
      (url: string) =>
        new Promise((done) => {
          release = (): void => done(serve(CATALOG, url));
        }),
    );
    const user = userEvent.setup();
    renderHarness(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Browse products' }));
    expect(await screen.findByText('Loading products…')).toBeTruthy();
    release!();
    await waitFor(() => expect(screen.getByText('Widget 01')).toBeTruthy());
    expect(screen.queryByText('Loading products…')).toBeNull();
  });

  it('shows the empty state while the selection count and Add stay', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness />);
    const dialog = await openPicker(user);
    await user.click(rowCheckbox('Widget 01'));

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing-matches' } });
    expect(await screen.findByText('No products match these filters.')).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Add 1' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a load error with Retry, which asks again', async () => {
    getSpy.mockRejectedValueOnce(new Error('boom'));
    getSpy.mockImplementation(async (url: string) => serve(CATALOG, url));
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderHarness(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: 'Browse products' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Products could not be loaded.')).toBeTruthy();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Widget 01')).toBeTruthy());
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- confirm, B10

describe('confirm (B6, B10)', () => {
  it('a sync confirm hands the items over in selection order and closes', async () => {
    useCatalog();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderHarness(<Harness onConfirm={onConfirm} />);
    const dialog = await openPicker(user);

    await user.click(rowCheckbox('Widget 03'));
    await user.click(rowCheckbox('Widget 01'));
    await user.click(within(dialog).getByRole('button', { name: 'Add 2' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const items = onConfirm.mock.calls[0]![0] as Item[];
    expect(items.map((i) => i.id)).toEqual(['a03', 'a01']);
    expect(items[1]).toEqual({
      id: 'a01',
      sku: 'SKU-A01',
      slug: 'a01',
      name: { 'en-US': 'Widget 01', 'pl-PL': 'Widżet 01' },
      status: 'active',
      type: 'simple',
      archivedAt: null,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('an async confirm is pending, stays open on reject with Retry re-sending the same items, closes on resolve', async () => {
    useCatalog();
    const attempts: Array<{ items: Item[]; settle: (ok: boolean) => void }> = [];
    const onConfirm = vi.fn(
      (items: Item[]) =>
        new Promise<void>((done, fail) => {
          attempts.push({ items, settle: (ok): void => (ok ? done() : fail(new Error('nope'))) });
        }),
    );
    const user = userEvent.setup();
    renderHarness(<Harness mode="async" rules={PRICE_LIST_RULES} onConfirm={onConfirm} />);
    const dialog = await openPicker(user);

    await user.click(rowCheckbox('Widget 02'));
    await user.click(rowCheckbox('Grouped set'));
    const add = within(dialog).getByRole('button', { name: 'Add 2' }) as HTMLButtonElement;
    await user.click(add);
    expect(add.disabled).toBe(true);

    attempts[0]!.settle(false);
    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByText('The products could not be added. Nothing was changed.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('2 selected')).toBeTruthy();

    const retry = within(alert).getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    await user.click(retry);
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(attempts[1]!.items).toEqual(attempts[0]!.items);
    expect(attempts[1]!.items.map((i) => i.id)).toEqual(['a02', 'g1']);
    expect((within(dialog).getByRole('button', { name: 'Add 2' }) as HTMLButtonElement).disabled).toBe(true);

    attempts[1]!.settle(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("renders the host's message for a failed confirm when it passes one", async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(
      <Harness
        mode="async"
        rules={PRICE_LIST_RULES}
        onConfirm={(): Promise<void> => Promise.reject(new Error('Price list not found'))}
        confirmErrorMessage={(err): string => (err as Error).message}
      />,
    );
    const dialog = await openPicker(user);
    await user.click(rowCheckbox('Widget 01'));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1' }));
    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByText('Price list not found')).toBeTruthy();
  });
});

// ---------------------------------------------------------------- B11, B12

describe('keyboard, focus and dialog semantics (B11)', () => {
  it('is a labelled modal dialog; focus moves in on open and back to the trigger on close', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Browse products' });
    const dialog = await openPicker(user);

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent).toBe('Add products to the order');
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('Esc cancels without confirming and discards the selection', async () => {
    useCatalog();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderHarness(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
    await openPicker(user);
    await user.click(rowCheckbox('Widget 01'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    // Reopened, the previous session's selection is gone.
    await openPicker(user);
    expect(screen.getByText('0 selected')).toBeTruthy();
  });

  it('a click on the scrim cancels without confirming', async () => {
    useCatalog();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderHarness(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
    await openPicker(user);
    await user.click(document.querySelector('.b2b-scrim') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('the trigger (B12)', () => {
  it('is disabled with the hint when the user lacks catalog:read', () => {
    useCatalog();
    const { container } = renderHarness(<Harness />, { permissions: ['orders:write'] });
    const trigger = screen.getByRole('button', { name: 'Browse products' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    const hint = document.getElementById(trigger.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('You need the catalog read permission to browse products.');
    expectNoRawKeys(container);
  });

  it("carries a host's own disabled reason", () => {
    renderHarness(
      <ProductBrowserTrigger onOpen={(): void => {}} disabled disabledReason="The Default list holds every product." />,
    );
    const trigger = screen.getByRole('button', { name: 'Browse products' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(document.getElementById(trigger.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'The Default list holds every product.',
    );
  });
});

// ---------------------------------------------------------------- StrictMode

describe('under <StrictMode>, as the admin renders it', () => {
  it('shows the rows of the first page after the dev double-mount', async () => {
    useCatalog();
    const user = userEvent.setup();
    renderHarness(<Harness />, { strict: true });
    const dialog = await openPicker(user);
    expect(within(dialog).getByText('Widget 01')).toBeTruthy();
    expect(within(dialog).queryByText('Loading products…')).toBeNull();
  });

  it('a rejected async confirm offers Retry, and a resolved one closes', async () => {
    useCatalog();
    const attempts: Array<(ok: boolean) => void> = [];
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((done, fail) => {
          attempts.push((ok): void => (ok ? done() : fail(new Error('nope'))));
        }),
    );
    const user = userEvent.setup();
    renderHarness(<Harness mode="async" rules={PRICE_LIST_RULES} onConfirm={onConfirm} />, {
      strict: true,
    });
    const dialog = await openPicker(user);
    await user.click(rowCheckbox('Widget 01'));
    await user.click(within(dialog).getByRole('button', { name: 'Add 1' }));

    attempts[0]!(false);
    const alert = await within(dialog).findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onConfirm).toHaveBeenCalledTimes(2);

    attempts[1]!(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
