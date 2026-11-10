// @vitest-environment jsdom
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { LINE_QUANTITY_MAX } from '@endora-commerce/contracts';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actionsOf, form, redirectOf } from '../url-errors/actions';

/**
 * Issue #351 — the API refuses a line quantity past `LINE_QUANTITY_MAX`. The quick-order page's
 * quantity inputs carry that bound as their `max`, and its actions, which already raise a typed
 * quantity below 1 to 1, keep a typed quantity within the bound, so the review step never holds a
 * line the build would refuse.
 */

let locale = 'en-US';
const builds: unknown[] = [];
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
vi.mock('../../lib/server-context', () => ({ getServerContext: async () => ({ locale, ctx: { locale } }) }));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/rfq', () => ({ getRfqById: async () => ({ businessId: 'RFQ-1' }) }));
vi.mock('../../lib/api/quick-order', () => ({
  searchProducts: async () => searchResults,
  buildQuickOrder: async (...args: unknown[]) => {
    builds.push(args);
    return { target: 'cart', cartId: 'c1', rejected: [] };
  },
  importQuickOrderCsv: async () => ({}),
  importQuickOrderFile: async () => ({}),
}));
vi.mock('../../lib/api/quick-order-preview', () => ({
  readQuickOrderPreview: async () => structuredClone(stored),
  writeQuickOrderPreview: async (_session: string, preview: unknown) => {
    stored = structuredClone(preview);
    return true;
  },
  clearQuickOrderPreview: async () => {
    stored = null;
  },
}));

const { default: QuickOrderPage } = await import('../../app/(account)/quick-order/page');

interface StoredPreview {
  recognized: Array<{ line: number; productId: string; quantity: number }>;
}

const PRODUCT = '00000000-0000-4000-8000-000000000101';

function previewOf(quantity: number) {
  return {
    recognized: [{ line: 2, sku: 'SKU-1', productId: PRODUCT, variantId: null, quantity }],
    rejected: [],
    summary: { recognizedCount: 1, rejectedCount: 0, mergedCount: 0, truncated: false },
  };
}

async function tree(q?: string): Promise<ReactElement<{ children: ReactNode[] }>> {
  const searchParams = Promise.resolve(q ? { q } : {});
  return (await QuickOrderPage({ searchParams })) as ReactElement<{ children: ReactNode[] }>;
}

/** The page's actions, the preview panel's included (a component `actionsOf` does not render). */
async function actions(q?: string): Promise<Map<string, (...args: never[]) => unknown>> {
  const page = await tree(q);
  const found = actionsOf(page);
  const panel = page.props.children.find(
    (child): child is ReactElement => isValidElement(child) && (child.type as { name?: string }).name === 'PreviewPanel',
  );
  if (panel) for (const [name, run] of actionsOf((panel.type as (props: unknown) => unknown)(panel.props))) found.set(name, run);
  return found;
}

beforeEach(() => {
  locale = 'en-US';
  builds.length = 0;
  stored = null;
  searchResults = [];
});

describe('quick order — the line quantity bound (issue #351)', () => {
  it('the search result\'s and the review step\'s quantity inputs carry the bound as their max', async () => {
    stored = previewOf(3);
    searchResults = [{ productId: PRODUCT, sku: 'SKU-1', name: 'Widget' }];
    const host = document.createElement('main');
    host.innerHTML = renderToString(<>{await tree('SKU')}</>);
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[name="quantity"]')];
    expect(inputs.length).toBe(2);
    for (const input of inputs) expect(input.max).toBe(String(LINE_QUANTITY_MAX));
  });

  it('a quantity typed past the bound is kept at the bound', async () => {
    stored = previewOf(3);
    const update = (await actions()).get('updateQuantityAction')!;
    await redirectOf(() => update(form({ line: '2', quantity: String(LINE_QUANTITY_MAX + 1) }) as never));
    expect((stored as StoredPreview).recognized[0]!.quantity).toBe(LINE_QUANTITY_MAX);
  });

  it('adding a search result to a line already at the bound keeps it there', async () => {
    stored = previewOf(LINE_QUANTITY_MAX);
    searchResults = [{ productId: PRODUCT, sku: 'SKU-1', name: 'Widget' }];
    const add = (await actions('SKU')).get('addSearchResultAction')!;
    await redirectOf(() => add(form({ productId: PRODUCT, sku: 'SKU-1', quantity: '5' }) as never));
    expect((stored as StoredPreview).recognized[0]!.quantity).toBe(LINE_QUANTITY_MAX);
  });
});
