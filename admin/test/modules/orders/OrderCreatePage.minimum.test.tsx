import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StrictMode, type ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 155, T107 — the admin create-order preview names a line below its
 * product's minimum (FR-009, contract `cart-and-checkout-api.md` §10): the
 * preview answers `BELOW_MINIMUM_QUANTITY` with the `minimum`, and the line
 * reads "Below the minimum of 10 pcs" instead of the generic **No price** it
 * fell into before. As for every other preview code, the line is unavailable:
 * no price, out of the subtotal, and submit stays blocked (Phase 8a).
 *
 * The bundle is `_i18n`'s **shipped** one, read off disk, in both languages,
 * so a missing key fails here instead of rendering as its own name.
 *
 * Rendered in `<StrictMode>`, as the admin root does. The last case unmounts
 * the page with a preview request still in flight and lets it answer
 * afterwards: the effect's cleanup must leave that answer with nowhere to go.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
  return { ...actual, useNavigate: () => vi.fn() };
});

const { OrderCreatePage } = await import('../../../../packages/modules/orders/src/admin/pages/OrderCreatePage');

type Language = 'en' | 'pl';

const REPO_ROOT = resolve(process.cwd(), '..');

function coreEntries(language: Language): Record<string, string> {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const ENTRIES: Record<Language, Record<string, string>> = { en: coreEntries('en'), pl: coreEntries('pl') };

function tr(language: Language, key: string, params: Record<string, string | number> = {}): string {
  const template = ENTRIES[language][key];
  if (template === undefined) throw new Error(`missing ${language} key ${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name]));
}

// ---------------------------------------------------------------- fakes

const LIST_PATH = '/api/v1/admin/catalog/products';
const CATALOG = [
  { id: 'a01', sku: 'SKU-A01', slug: 'a01', name: { 'en-US': 'Bolt' }, status: 'active', type: 'simple' },
  { id: 'a02', sku: 'SKU-A02', slug: 'a02', name: { 'en-US': 'Nut' }, status: 'active', type: 'simple' },
];

function serveCatalog(url: string): unknown {
  const q = (new URLSearchParams(url.split('?')[1] ?? '').get('q') ?? '').toLowerCase();
  const rows = CATALOG.filter(
    (p) => q === '' || p.sku.toLowerCase().includes(q) || p.name['en-US'].toLowerCase().includes(q),
  );
  return {
    data: rows,
    pagination: { page: 0, pageSize: 20, total: rows.length },
    counts: { all: rows.length, active: rows.length, inactive: 0, archived: 0 },
  };
}

interface PreviewBody {
  items: Array<{ productId: string; quantity: number }>;
}

/** `a01` is below its minimum of 10; `a02` prices at 10.00. */
function servePreview(body: PreviewBody): unknown {
  const below = (it: { productId: string }): boolean => it.productId === 'a01';
  const lines = body.items.map((it) =>
    below(it)
      ? { productId: it.productId, quantity: it.quantity, unitPrice: '0', currency: 'PLN', lineTotal: 0, unavailable: true }
      : { productId: it.productId, quantity: it.quantity, unitPrice: '10.00', currency: 'PLN', lineTotal: 10 * it.quantity },
  );
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  return {
    data: {
      lines,
      summary: { subtotal, taxTotal: 0, deliveryTotal: 0, paymentSurcharge: 0, discountTotal: 0, total: subtotal, currency: 'PLN' },
      messages: body.items
        .filter(below)
        .map((it) => ({ productId: it.productId, code: 'BELOW_MINIMUM_QUANTITY', minimum: 10 })),
    },
  };
}

const CUSTOMER = { id: 'cust-1', email: 'jan@acme.test', firstName: 'Jan', lastName: 'Kowalski', organizationName: 'Acme' };

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/addresses')) return Promise.resolve({ data: { personal: [], organization: [] } });
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith(`${LIST_PATH}?`)) return Promise.resolve(serveCatalog(path));
    if (path.startsWith(`${LIST_PATH}/`)) {
      const row = CATALOG.find((p) => p.id === path.slice(LIST_PATH.length + 1));
      return row ? Promise.resolve({ data: row }) : Promise.reject(new Error('not found'));
    }
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({ items: [{ id: 'chan-1', code: 'CH', name: { 'en-US': 'Channel 1' }, active: true }] });
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string, body: unknown) => {
    if (path.endsWith('/orders/preview')) return Promise.resolve(servePreview(body as PreviewBody));
    return Promise.resolve({ data: { id: 'new-order-1' } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage(language: Language): ReturnType<typeof render> {
  const ui: ReactElement = (
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={['/orders/new?customerAccountId=cust-1&salesChannelId=chan-1']}>
          <OrderCreatePage />
        </MemoryRouter>,
        {
          session: adminSession({ permissions: ['*'] }),
          presence: modulePresence({ present: ['orders', 'quick_order'] }),
        },
      )}
    </StrictMode>
  );
  return render(
    <TranslationProvider language={language} initialBundle={{ core: ENTRIES[language] }}>
      {ui}
    </TranslationProvider>,
  );
}

async function quickAdd(user: ReturnType<typeof userEvent.setup>, language: Language, name: string): Promise<void> {
  const quick = screen.getByRole('combobox', { name: tr(language, 'orderCreate.items.quickSearch') });
  await user.clear(quick);
  await user.type(quick, name);
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

function lineRow(name: string): HTMLElement {
  const row = screen.getByText(name, { selector: '[data-line-name]' }).closest('tr');
  if (!row) throw new Error(`no line row for ${name}`);
  return row as HTMLElement;
}

describe.each<Language>(['en', 'pl'])('OrderCreatePage — BELOW_MINIMUM_QUANTITY (%s)', (language) => {
  it('names the line below the minimum with the minimum, not "No price", and blocks submit (FR-009)', async () => {
    const user = userEvent.setup();
    renderPage(language);
    await quickAdd(user, language, 'Bolt');
    await quickAdd(user, language, 'Nut');

    const belowMinimum = tr(language, 'orderCreate.line.belowMinimum', { minimum: 10 });
    await waitFor(() => expect(within(lineRow('Bolt')).getByText(belowMinimum)).toBeInTheDocument());
    expect(within(lineRow('Bolt')).queryByText(tr(language, 'orderCreate.line.unavailable'))).toBeNull();
    // The reason describes the quantity field it judges.
    const qty = within(lineRow('Bolt')).getByRole('textbox');
    const describedBy = qty.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent).toBe(belowMinimum);
    // The other line keeps its price and shows no reason.
    expect(within(lineRow('Nut')).queryByText(belowMinimum)).toBeNull();
    expect(screen.getByRole('button', { name: tr(language, 'orderCreate.submit') })).toBeDisabled();
  });
});

describe('OrderCreatePage — a preview answering after unmount', () => {
  it('sets no state once the page is gone', async () => {
    let answer: (value: unknown) => void = () => undefined;
    postSpy.mockImplementation((path: string, body: unknown) => {
      if (path.endsWith('/orders/preview')) {
        return new Promise((resolvePreview) => {
          answer = (): void => resolvePreview(servePreview(body as PreviewBody));
        });
      }
      return Promise.resolve({ data: { id: 'new-order-1' } });
    });
    const consoleError = vi.spyOn(console, 'error');
    const user = userEvent.setup();
    const { unmount } = renderPage('en');
    await quickAdd(user, 'en', 'Bolt');
    await waitFor(() => expect(postSpy.mock.calls.some(([p]) => String(p).endsWith('/orders/preview'))).toBe(true));

    unmount();
    await act(async () => {
      answer(undefined);
      await Promise.resolve();
    });

    // Only the warning this case is about; an unrelated console error is not its subject.
    const unmountedUpdate = consoleError.mock.calls.filter((call) =>
      call.some((arg) => /state update on an unmounted component/i.test(String(arg))),
    );
    expect(unmountedUpdate).toEqual([]);
    consoleError.mockRestore();
  });
});
