import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import type { Bundle } from '../../../../packages/admin-shell/src/i18n/types';
import { MemoryRouter } from 'react-router-dom';
import { CATALOG, IDS, PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';
import { withSession } from '../../helpers/render-with-session';

/**
 * The display-mode page names a category or a product override in the admin
 * language (feature 161, pre-Phase-4 fix).
 *
 * On `master` the page read `/pricing/rule-targets/categories`; on the release
 * branch it reads `/price-books/targets/categories`, whose names — like the
 * admin product list's — are maps keyed by language tag. Rendered as they
 * came, an override of either scope would put an object into the tree. The
 * names are picked as every other admin surface picks them
 * (`pickCategoryDisplayName`: the admin language's tag, then `en-US`, then any,
 * then the slug or SKU).
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { contributions } = await import('@endora-commerce/mod-price-lists/admin');
const route = contributions.routes?.find((r) => r.path === '/price-lists/display-modes');
const Page = ((await route!.component()) as { default: ComponentType }).default;

const REPO_ROOT = resolve(process.cwd(), '..');
function coreBundle(language: 'en' | 'pl'): Bundle {
  return {
    core: JSON.parse(readFileSync(join(REPO_ROOT, 'packages/modules/_i18n/i18n', `${language}.json`), 'utf8')) as Record<string, string>,
  };
}

const PRODUCT = { id: IDS.products.P1, sku: 'P1', name: { 'en-US': 'Screws 0200', 'pl-PL': 'Wkręty 0200' } };

function answer(url: string): unknown {
  if (url.includes('/display-mode-overrides?scope=category')) {
    return { data: { items: [{ scope: 'category', targetId: IDS.categories.screws, mode: 'net_only', updatedAt: '2026-10-22T10:00:00.000Z' }] } };
  }
  if (url.includes('/display-mode-overrides?scope=product')) {
    return { data: { items: [{ scope: 'product', targetId: PRODUCT.id, mode: 'both', updatedAt: '2026-10-22T10:00:00.000Z' }] } };
  }
  if (url.includes('/display-mode-overrides?scope=')) return { data: { items: [] } };
  if (url.includes('/targets/organizations')) return { data: { items: CATALOG.organizations } };
  if (url.includes('/targets/categories')) return { data: { items: CATALOG.categories } };
  if (url.includes('/admin/catalog/products')) return { data: [PRODUCT] };
  if (url.includes('/admin/settings/')) return { defaultValue: 'gross_only' };
  // Feature 161 — the page is *Pricing settings* now, and reads the list-price
  // setting and the precedence beside the overrides.
  if (url.endsWith('/price-books/settings/show-list-price')) return { data: { value: false } };
  if (url.endsWith('/price-books/precedence')) {
    return {
      data: {
        version: 1,
        preset: 'HY',
        categoryBeforeAttribute: true,
        depthMode: 'within_cell',
        cells: [
          'org.variant', 'org.product', 'org.category_attribute', 'org.category', 'org.attribute',
          'group.variant', 'group.product', 'group.category_attribute', 'group.category', 'group.attribute',
          'org.all', 'group.all',
        ],
      },
    };
  }
  throw new Error(`unexpected url ${url}`);
}

function mount(language: 'en' | 'pl'): void {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={coreBundle(language)}>
      {/* Feature 161 — the page's precedence section reads the address and its
          list-price switch the session, as every admin screen may. */}
      {withSession(<MemoryRouter>{children}</MemoryRouter>, { session: PLATFORM_ADMIN })}
    </TranslationProvider>
  );
  render(<Page />, { wrapper });
}

describe('DisplayModeOverridesPage — names in the admin language', () => {
  beforeEach(() => {
    getSpy.mockReset();
    getSpy.mockImplementation(async (url: string) => answer(url));
  });

  it('names a category override in English, with its slug', async () => {
    const user = userEvent.setup();
    mount('en');
    await user.click(await screen.findByRole('button', { name: 'Category' }));
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Screws')).toBeInTheDocument();
    expect(within(table).getByText('screws')).toBeInTheDocument();
  });

  it('names a category override in Polish', async () => {
    const user = userEvent.setup();
    mount('pl');
    await user.click(await screen.findByRole('button', { name: 'Kategoria' }));
    expect(await within(await screen.findByRole('table')).findByText('Wkręty')).toBeInTheDocument();
  });

  it('names a product override in the admin language, with its SKU', async () => {
    const user = userEvent.setup();
    mount('pl');
    await user.click(await screen.findByRole('button', { name: 'Produkt' }));
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Wkręty 0200')).toBeInTheDocument();
    expect(within(table).getByText('P1')).toBeInTheDocument();
  });
});
