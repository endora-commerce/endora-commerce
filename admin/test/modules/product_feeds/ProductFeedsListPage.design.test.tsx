import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import type { ProductFeedDto } from '../../../src/modules/product_feeds/api';

/**
 * The feed list hand-rolled its surfaces (`rounded-lg border p-8`) instead of
 * reaching for `.b2b-card` / `.b2b-empty`, so it read as a different product
 * from every neighbouring page. These assertions pin the shared classes and
 * the token-driven warning colour.
 */

const list = vi.fn();

vi.mock('../../../src/modules/product_feeds/api', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/modules/product_feeds/api')
  >('../../../src/modules/product_feeds/api');
  return {
    ...actual,
    productFeedsClient: {
      ...actual.productFeedsClient,
      list: (): Promise<{ data: ProductFeedDto[] }> => list(),
      artefactUrl: (id: string): string => `/artefact/${id}`,
    },
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

const bundle = passthroughBundle('product_feeds', [
  'page.title',
  'page.subtitle',
  'page.templates',
  'page.newFeed',
  'feeds.empty.title',
  'feeds.empty.subtitle',
  'feeds.table.status',
  'feeds.table.name',
  'feeds.table.channel',
  'feeds.table.template',
  'feeds.table.lastRun',
  'feeds.table.items',
  'feeds.table.nextRun',
  'feeds.table.never',
  'feeds.table.manualOnly',
  'feeds.table.scheduleTooTight',
  'feeds.action.generate',
  'feeds.action.open',
  'feeds.action.download',
  'feeds.action.delete',
  'permission.needWrite',
]);

const { ProductFeedsListPage } = await import(
  '../../../src/modules/product_feeds/ProductFeedsListPage'
);

function feed(over: Partial<ProductFeedDto> = {}): ProductFeedDto {
  return {
    id: 'f1',
    name: 'Google Shopping',
    slug: 'google-shopping',
    feedTemplateId: 't1',
    feedTemplateName: 'Google',
    salesChannelId: 'sc1',
    salesChannelCode: 'web',
    languageCode: 'pl',
    currencyCode: 'PLN',
    priceListId: null,
    pricePresentation: 'gross',
    taxCountry: null,
    selectionRule: { kind: 'all' },
    schedule: null,
    enabled: true,
    token: { status: 'active' },
    lastRun: null,
    nextRunAt: null,
    publishedArtefactId: null,
    publishedItemCount: null,
    publishedAt: null,
    isRunning: false,
    scheduleTooTightWarning: false,
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    ...over,
  } as ProductFeedDto;
}

function renderPage(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/product-feeds']}>
      <ProductFeedsListPage />
    </MemoryRouter>,
    bundle,
  );
}

describe('ProductFeedsListPage — design-system alignment', () => {
  beforeEach(() => {
    list.mockReset();
  });

  it('renders the empty state through the shared .b2b-empty block', async () => {
    list.mockResolvedValue({ data: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('feeds.empty.title')).toBeTruthy());
    const empty = document.querySelector('.b2b-empty');
    expect(empty).not.toBeNull();
    expect(empty?.querySelector('.b2b-empty__icon')).not.toBeNull();
    expect(empty?.querySelector('.b2b-empty__title')?.textContent).toBe('feeds.empty.title');
    expect(empty?.querySelector('.b2b-empty__sub')?.textContent).toBe('feeds.empty.subtitle');
  });

  it('renders the loading placeholder on a card surface rather than a bare border', async () => {
    list.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    const busy = document.querySelector('[aria-busy="true"]') as HTMLElement;
    expect(busy.className).toContain('b2b-card');
    expect(busy.className).not.toMatch(/\brounded-lg border\b/);
  });

  it('colours the too-tight schedule warning from the --warn token', async () => {
    list.mockResolvedValue({ data: [feed({ scheduleTooTightWarning: true })] });
    renderPage();
    const warning = await screen.findByText('feeds.table.scheduleTooTight');
    expect(warning.className).not.toMatch(/text-amber-\d{3}/);
    expect(warning.getAttribute('style')).toContain('var(--warn)');
  });
});
