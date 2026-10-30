import { StrictMode, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 155, T108 — the operator's quick-order import (FR-011 (a), P1 C,
 * US4 #1d). A row whose product's file total is below the pieces minimum is
 * **not** rejected on the admin route: it stays among the buildable rows —
 * it is sent in the build — with a "below minimum (10 pcs)" badge. A build to
 * the customer's **cart** still refuses it and the screen lists the refused
 * lines with product and minimum (FR-011 (b)); a build to a **quote request**
 * refuses nothing (FR-012, FR-030), so the screen lists nothing.
 *
 * The bundle is the module's **shipped** one, read off disk, in both
 * languages. Rendered in `<StrictMode>`, as the admin root does.
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

/** The two pickers as plain inputs: what they search is not this file's subject. */
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  const Plain = (props: { id: string; ariaLabel: string; onChange: (v: string | null) => void }): ReactElement => (
    <input id={props.id} aria-label={props.ariaLabel} onChange={(e) => props.onChange(e.target.value || null)} />
  );
  return { ...actual, CustomerPicker: Plain, OrganizationPicker: Plain };
});

const { QuickOrderOnBehalfPage } = await import(
  '../../../../packages/modules/quick_order/src/admin/pages/QuickOrderOnBehalfPage'
);

type Language = 'en' | 'pl';

const REPO_ROOT = resolve(process.cwd(), '..');

function bundle(language: Language): Record<string, string> {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages/modules/quick_order/i18n', `${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const ENTRIES: Record<Language, Record<string, string>> = { en: bundle('en'), pl: bundle('pl') };

function tr(language: Language, key: string, params: Record<string, string | number> = {}): string {
  const template = ENTRIES[language][key];
  if (template === undefined) throw new Error(`missing ${language} key ${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name]));
}

const BOLT = '00000000-0000-4000-8000-0000000000b1';
const NUT = '00000000-0000-4000-8000-0000000000b2';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';

const IMPORT = {
  recognized: [
    {
      line: 2,
      sku: 'BOLT',
      productId: BOLT,
      variantId: null,
      quantity: 5,
      warning: { reason: 'below_minimum', minimum: 10, productTotal: 5 },
    },
    { line: 3, sku: 'NUT', productId: NUT, variantId: null, quantity: 4 },
  ],
  rejected: [{ line: 4, raw: 'GHOST,1', reason: 'product_not_found' }],
  summary: { recognizedCount: 2, rejectedCount: 1, mergedCount: 0, truncated: false, warningCount: 1 },
};

const CART_BUILD = {
  target: 'cart',
  cartId: '00000000-0000-4000-8000-0000000000d1',
  rejected: [
    {
      productId: BOLT,
      variantId: null,
      quantity: 5,
      productName: 'Steel bolt',
      reason: 'below_minimum',
      kind: 'pieces',
      minimum: 10,
    },
  ],
};

const QUOTE_BUILD = { target: 'quote_request', quoteRequestId: '00000000-0000-4000-8000-0000000000e1' };

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockResolvedValue({ data: [] });
  postSpy.mockImplementation((path: string, body: { target?: string }) => {
    if (path === '/api/v1/admin/quick-order/import') return Promise.resolve({ data: IMPORT });
    if (path === '/api/v1/admin/quick-order/build') {
      return Promise.resolve({ data: body.target === 'cart' ? CART_BUILD : QUOTE_BUILD });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

function renderPage(language: Language): void {
  render(
    <TranslationProvider language={language} initialBundle={{ quick_order: ENTRIES[language] }}>
      <StrictMode>
        {withSession(
          <MemoryRouter initialEntries={['/orders/quick-order']}>
            <QuickOrderOnBehalfPage />
          </MemoryRouter>,
          {
            session: adminSession({ permissions: ['orders:write'] }),
            presence: modulePresence({ present: ['orders', 'quick_order'] }),
            contributions: [],
          },
        )}
      </StrictMode>
    </TranslationProvider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

async function importPreview(user: User, language: Language): Promise<void> {
  await user.type(screen.getByLabelText(tr(language, 'onBehalf.customer.account')), CUSTOMER_ID);
  await user.type(screen.getByLabelText(tr(language, 'onBehalf.customer.organization')), ORG_ID);
  await user.type(screen.getByLabelText(tr(language, 'onBehalf.import.pasteLabel')), 'sku,quantity');
  await user.click(screen.getByRole('button', { name: tr(language, 'onBehalf.import.preview') }));
  await screen.findByText('BOLT');
}

function recognizedRow(sku: string): HTMLElement {
  const row = screen.getByText(sku).closest('tr');
  if (!row) throw new Error(`no row for ${sku}`);
  return row as HTMLElement;
}

function buildBodies(): Array<{ target: string; items: Array<{ productId: string; quantity: number }> }> {
  return postSpy.mock.calls
    .filter(([p]) => p === '/api/v1/admin/quick-order/build')
    .map(([, b]) => b as { target: string; items: Array<{ productId: string; quantity: number }> });
}

describe.each<Language>(['en', 'pl'])('Quick order on behalf — below the minimum (%s)', (language) => {
  const badge = (): string => tr(language, 'onBehalf.minimum.badge', { minimum: 10 });

  it('keeps a warned row buildable and badges it "below minimum (10 pcs)" (US4 #1d)', async () => {
    const user = userEvent.setup();
    renderPage(language);
    await importPreview(user, language);

    expect(within(recognizedRow('BOLT')).getByText(badge())).toBeInTheDocument();
    expect(within(recognizedRow('NUT')).queryByText(badge())).toBeNull();
    // A warned row is not among the rejected ones.
    expect(screen.queryByText(tr(language, 'onBehalf.reason.below_minimum'))).toBeNull();
    // Both build actions stay available.
    expect(screen.getByRole('button', { name: tr(language, 'onBehalf.action.buildCart') })).toBeEnabled();
    expect(screen.getByRole('button', { name: tr(language, 'onBehalf.action.buildQuoteRequest') })).toBeEnabled();
  });

  it('includes the warned row in a quote-request build and lists no rejection (FR-012, FR-030)', async () => {
    const user = userEvent.setup();
    renderPage(language);
    await importPreview(user, language);
    await user.click(screen.getByRole('button', { name: tr(language, 'onBehalf.action.buildQuoteRequest') }));

    await screen.findByText(tr(language, 'onBehalf.success.quoteRequest', { id: QUOTE_BUILD.quoteRequestId }));
    expect(buildBodies().at(-1)).toMatchObject({
      target: 'quote_request',
      items: [
        { productId: BOLT, quantity: 5 },
        { productId: NUT, quantity: 4 },
      ],
    });
    expect(screen.queryByText(tr(language, 'onBehalf.build.rejectedTitle'))).toBeNull();
  });

  it('lists a cart build\'s rejected lines with product and minimum (FR-011 (b))', async () => {
    const user = userEvent.setup();
    renderPage(language);
    await importPreview(user, language);
    await user.click(screen.getByRole('button', { name: tr(language, 'onBehalf.action.buildCart') }));

    expect(await screen.findByText(tr(language, 'onBehalf.build.rejectedTitle'))).toBeInTheDocument();
    expect(
      screen.getByText(
        tr(language, 'onBehalf.build.rejectedPieces', { product: 'Steel bolt', quantity: 5, minimum: 10 }),
      ),
    ).toBeInTheDocument();
    expect(buildBodies().at(-1)?.items.map((i) => i.productId)).toEqual([BOLT, NUT]);
  });

  it('labels a buyer-style below_minimum rejection with its minimum and file total', async () => {
    postSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/quick-order/import') {
        return Promise.resolve({
          data: {
            recognized: [{ line: 3, sku: 'NUT', productId: NUT, variantId: null, quantity: 4 }],
            rejected: [{ line: 2, raw: 'BOLT,3', reason: 'below_minimum', minimum: 10, productTotal: 7 }],
            summary: { recognizedCount: 1, rejectedCount: 1, mergedCount: 0, truncated: false },
          },
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const user = userEvent.setup();
    renderPage(language);
    await user.type(screen.getByLabelText(tr(language, 'onBehalf.import.pasteLabel')), 'sku,quantity');
    await user.click(screen.getByRole('button', { name: tr(language, 'onBehalf.import.preview') }));

    await waitFor(() =>
      expect(
        screen.getByText(tr(language, 'onBehalf.reason.below_minimumDetail', { minimum: 10, productTotal: 7 })),
      ).toBeInTheDocument(),
    );
  });
});

describe.each<Language>(['en', 'pl'])('Quick order on behalf — a packaging-unit build refusal (%s)', (language) => {
  // Tested through the page, as the operator sees it — not by importing the page's helper.
  it('names the packaging unit in the refusal (coordinator addition to FR-011 (b))', async () => {
    postSpy.mockImplementation((path: string, body: { target?: string }) => {
      if (path === '/api/v1/admin/quick-order/import') return Promise.resolve({ data: IMPORT });
      if (path === '/api/v1/admin/quick-order/build' && body.target === 'cart') {
        return Promise.resolve({
          data: {
            ...CART_BUILD,
            rejected: [
              {
                productId: BOLT,
                variantId: null,
                quantity: 64,
                productName: 'Steel bolt',
                reason: 'below_minimum',
                kind: 'packaging_unit',
                minimum: 2,
                packagingUnitName: 'Pallet',
              },
            ],
          },
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const user = userEvent.setup();
    renderPage(language);
    await importPreview(user, language);
    await user.click(screen.getByRole('button', { name: tr(language, 'onBehalf.action.buildCart') }));

    expect(
      await screen.findByText(
        tr(language, 'onBehalf.build.rejectedUnits', { product: 'Steel bolt', quantity: 64, minimum: 2, unit: 'Pallet' }),
      ),
    ).toBeInTheDocument();
  });
});
