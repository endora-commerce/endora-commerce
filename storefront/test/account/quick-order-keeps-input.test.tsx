// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINE_QUANTITY_MAX } from '@endora-commerce/contracts';

/**
 * Issue #1253 — on the quick-order page the pasted list, the search box and each search result's
 * quantity + *Add* are separate forms, each of which reloads the page. What the buyer typed into
 * the forms they did not submit is kept in the tab's `sessionStorage` and put back after the
 * reload: the pasted list survives a search, and the quantities typed in other result rows survive
 * an *Add* on one row. The row that was added starts again at 1, as it always did, and a finished
 * build forgets both. Without JavaScript the fields are the plain form fields they were.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let stored: unknown = null;
let searchResults: unknown[] = [];

vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      organizationRole: { id: 'role-admin', kind: 'administrator', name: 'Administrator' },
      permissions: ['carts.create', 'quote_requests.create'],
    },
    organization: null,
    impersonation: null,
  }),
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({ getServerContext: async () => ({ locale: 'en-US', ctx: { locale: 'en-US' } }) }));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/rfq', () => ({ getRfqById: async () => ({ businessId: 'RFQ-1' }) }));
vi.mock('../../lib/api/quick-order', () => ({
  searchProducts: async () => searchResults,
  buildQuickOrder: async () => ({ target: 'cart', cartId: 'c1', rejected: [] }),
  importQuickOrderCsv: async () => ({}),
  importQuickOrderFile: async () => ({}),
}));
vi.mock('../../lib/api/quick-order-preview', () => ({
  readQuickOrderPreview: async () => structuredClone(stored),
  writeQuickOrderPreview: async () => true,
  clearQuickOrderPreview: async () => {
    stored = null;
  },
}));

const { default: QuickOrderPage } = await import('../../app/(account)/quick-order/page');
const { QuickOrderPasteField, QuickOrderResultQuantity } = await import(
  '../../components/quick-order/QuickOrderKeptFields'
);

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

let host: HTMLElement | null = null;
let root: Root | null = null;

/** Renders the page's markup as a server would, then hydrates nothing: the no-JavaScript page. */
async function serverMarkup(searchParams: Record<string, string>): Promise<HTMLElement> {
  const el = document.createElement('main');
  el.innerHTML = renderToString(<>{await QuickOrderPage({ searchParams: Promise.resolve(searchParams) })}</>);
  return el;
}

/** Mounts the page as the browser shows it after a load: the client fields run their effects. */
async function load(node: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

/** The page reloads: everything in it is gone but what the tab kept. */
function reload(): void {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
}

function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** A form submitted the way a browser does it before the page goes away. */
function submit(form: HTMLFormElement): void {
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function PasteForm({ forget = false }: { forget?: boolean }) {
  return (
    <form>
      <QuickOrderPasteField id="csv" name="csv" rows={8} placeholder="sku,quantity" forget={forget} />
    </form>
  );
}

function ResultRows({ forget = false }: { forget?: boolean }) {
  return (
    <>
      {[A, B].map((id) => (
        <form key={id} id={`add-${id}`}>
          <QuickOrderResultQuantity productId={id} ariaLabel={`Quantity for ${id}`} forget={forget} />
        </form>
      ))}
    </>
  );
}

/**
 * An in-memory `Storage`: under this jsdom the window's own is not there (Node's experimental
 * global `localStorage` shadows it without a backing file), and the test is about what is kept.
 */
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(), configurable: true });
  stored = null;
  searchResults = [];
});

afterEach(() => reload());

describe('quick order — the pasted list survives a search (issue #1253)', () => {
  it('is put back into the paste box after the page reloads', async () => {
    const page = await load(<PasteForm />);
    typeInto(page.querySelector('textarea')!, 'sku,quantity\nSKU-1,40');
    reload();

    const after = await load(<PasteForm />);
    expect(after.querySelector('textarea')!.value).toBe('sku,quantity\nSKU-1,40');
  });

  it('is forgotten once a build has used it', async () => {
    typeInto((await load(<PasteForm />)).querySelector('textarea')!, 'sku,quantity\nSKU-1,40');
    reload();
    expect((await load(<PasteForm forget />)).querySelector('textarea')!.value).toBe('');
    reload();
    expect((await load(<PasteForm />)).querySelector('textarea')!.value).toBe('');
  });

  it('the page server-renders it as the plain paste field it was', async () => {
    const page = await serverMarkup({ q: 'SKU' });
    const textarea = page.querySelector<HTMLTextAreaElement>('form textarea[name="csv"]')!;
    expect(textarea).not.toBeNull();
    expect(textarea.id).toBe('csv');
    expect(page.querySelector('label[for="csv"]')).not.toBeNull();
  });
});

describe('quick order — quantities typed in other result rows survive an Add (issue #1253)', () => {
  it('keeps the other rows and starts the added row again at 1', async () => {
    const page = await load(<ResultRows />);
    const [qtyA, qtyB] = [...page.querySelectorAll<HTMLInputElement>('input[name="quantity"]')];
    typeInto(qtyA!, '12');
    typeInto(qtyB!, '7');
    submit(page.querySelector<HTMLFormElement>(`#add-${A}`)!);
    reload();

    const after = await load(<ResultRows />);
    const [againA, againB] = [...after.querySelectorAll<HTMLInputElement>('input[name="quantity"]')];
    expect(againA!.value).toBe('1');
    expect(againB!.value).toBe('7');
  });

  it('forgets the typed quantities once a build is done', async () => {
    typeInto((await load(<ResultRows />)).querySelectorAll<HTMLInputElement>('input[name="quantity"]')[1]!, '7');
    reload();
    await load(<ResultRows forget />);
    reload();
    const after = await load(<ResultRows />);
    expect(after.querySelectorAll<HTMLInputElement>('input[name="quantity"]')[1]!.value).toBe('1');
  });

  it('the page server-renders each row\'s quantity as the plain bounded field it was', async () => {
    searchResults = [
      { productId: A, sku: 'SKU-A', name: 'Widget A' },
      { productId: B, sku: 'SKU-B', name: 'Widget B' },
    ];
    const page = await serverMarkup({ q: 'SKU' });
    const inputs = [...page.querySelectorAll<HTMLInputElement>('input[name="quantity"]')];
    expect(inputs).toHaveLength(2);
    for (const [i, input] of inputs.entries()) {
      expect(input.type).toBe('number');
      expect(input.value).toBe('1');
      expect(input.min).toBe('1');
      expect(input.max).toBe(String(LINE_QUANTITY_MAX));
      expect(input.getAttribute('form') ?? input.closest('form')?.id).toBe(`add-${[A, B][i]}`);
      expect(input.getAttribute('aria-label')).toBe(`Quantity for ${['SKU-A', 'SKU-B'][i]}`);
    }
  });
});
