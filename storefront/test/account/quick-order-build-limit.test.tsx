// @vitest-environment jsdom
import axe from 'axe-core';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actionsOf, form, redirectOf } from '../url-errors/actions';

/**
 * PO ruling of 2026-11-08 on PR #942 (issue #809), Q2 — a build takes at most 200 items
 * (`QUICK_ORDER_BUILD_MAX_ITEMS`), and the preview now holds far more. A buyer must not review
 * 2 000 lines to learn only from a refusal that nothing can be built: past 200 recognised lines
 * (rejected rows are not built, so they do not count) the review step says so above its actions,
 * *Add all to cart* and *Send as quote request* are disabled and described by that notice, and no
 * build request is sent. The backend's `422 too_many_items` stays the guard.
 */

let locale = 'en-US';
const builds: unknown[] = [];
let stored: unknown = null;

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
  searchProducts: async () => [],
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

function previewOf(recognized: number, rejected = 0) {
  return {
    recognized: Array.from({ length: recognized }, (_, index) => ({
      line: index + 2,
      sku: `SKU-${index}`,
      productId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      variantId: null,
      quantity: 1,
    })),
    rejected: Array.from({ length: rejected }, (_, index) => ({
      line: recognized + index + 2,
      raw: `NOPE-${index},1`,
      reason: 'product_not_found',
    })),
    summary: { recognizedCount: recognized, rejectedCount: rejected, mergedCount: 0, truncated: false },
  };
}

async function tree(): Promise<ReactElement<{ children: ReactNode[] }>> {
  return (await QuickOrderPage({ searchParams: Promise.resolve({}) })) as ReactElement<{ children: ReactNode[] }>;
}

async function html(): Promise<string> {
  return renderToString(<>{await tree()}</>).replaceAll('<!-- -->', '');
}

/** The page's actions, the preview panel's included (a component `actionsOf` does not render). */
async function actions(): Promise<Map<string, (...args: never[]) => unknown>> {
  const page = await tree();
  const found = actionsOf(page);
  const panel = page.props.children.find(
    (child): child is ReactElement => isValidElement(child) && (child.type as { name?: string }).name === 'PreviewPanel',
  );
  if (panel) for (const [name, run] of actionsOf((panel.type as (props: unknown) => unknown)(panel.props))) found.set(name, run);
  return found;
}

function dom(markup: string): HTMLElement {
  const host = document.createElement('main');
  host.innerHTML = markup;
  document.body.replaceChildren(host);
  return host;
}

const EN = 'This list has 201 lines that can be added. Up to 200 can be added to the cart or sent as a quote request at once. Remove lines, or split the file, to continue.';
const PL = 'Ta lista zawiera pozycje do dodania: 201. Do koszyka lub do zapytania ofertowego można dodać jednorazowo najwyżej 200. Usuń część pozycji albo podziel plik, aby kontynuować.';

beforeEach(() => {
  locale = 'en-US';
  builds.length = 0;
  stored = null;
});

describe('quick order — the 200-item build limit is said up front (PR #942, Q2)', () => {
  it('201 recognised lines: the notice shows, both actions are disabled and described by it', async () => {
    stored = previewOf(201, 7);
    const host = dom(await html());
    const notice = [...host.querySelectorAll('[id]')].find((node) => node.textContent === EN);
    expect(notice, 'the notice').toBeDefined();
    const id = notice!.id;
    const buttons = [...host.querySelectorAll('button')].filter((button) =>
      ['Add all to cart', 'Send as quote request'].includes(button.textContent ?? ''),
    );
    expect(buttons.map((button) => button.textContent)).toEqual(['Add all to cart', 'Send as quote request']);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-describedby')?.split(' ')).toContain(id);
    }
    // The mobile bar's add-all is the same action.
    const bar = host.querySelector('.m-actionbar button') as HTMLButtonElement | null;
    if (bar) {
      expect(bar.disabled).toBe(true);
      expect(bar.getAttribute('aria-describedby')?.split(' ')).toContain(id);
    }
  });

  it('reads in Polish', async () => {
    stored = previewOf(201);
    locale = 'pl-PL';
    expect(await html()).toContain(PL);
  });

  it('sends no build request past 200 lines', async () => {
    stored = previewOf(201);
    const confirm = (await actions()).get('confirmAction')!;
    expect(await redirectOf(() => confirm(form({ target: 'cart' }) as never))).toBe(
      '/quick-order?problem=VALIDATION_FAILED.too_many_items',
    );
    expect(builds).toEqual([]);
  });

  it('one line removed, leaving 200: the notice goes and the build succeeds', async () => {
    stored = previewOf(201);
    const remove = (await actions()).get('removeRecognizedAction')!;
    await redirectOf(() => remove(form({ line: '2' }) as never));
    const markup = await html();
    expect(markup).not.toContain(EN.slice(0, 30));
    expect(dom(markup).querySelector('button[disabled]')).toBeNull();

    const confirm = (await actions()).get('confirmAction')!;
    expect(await redirectOf(() => confirm(form({ target: 'cart' }) as never))).toBe('/quick-order?built=cart');
    expect(builds).toHaveLength(1);
  });

  it('150 recognised and 300 rejected: no notice', async () => {
    stored = previewOf(150, 300);
    const markup = await html();
    expect(markup).not.toContain('lines that can be added');
    expect(dom(markup).querySelector('button[disabled]')).toBeNull();
  });

  it.each(['en-US', 'pl-PL'])('the review step has no WCAG 2.2 AA violation axe can find (%s)', async (language) => {
    locale = language;
    stored = previewOf(201, 2);
    // The review step is the preview panel; the rest of the page is not this change's.
    const page = await tree();
    const panel = page.props.children.find(
      (child): child is ReactElement => isValidElement(child) && (child.type as { name?: string }).name === 'PreviewPanel',
    )!;
    const result = await axe.run(dom(renderToString(panel)), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
  }, 120_000);
});
