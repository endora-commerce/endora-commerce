import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import type { FeedRunDetail, ProductFeedDto } from '../../../../packages/modules/product_feeds/src/admin/api';

/**
 * Issue #1491 (UX audit 2026-11-17, CAT-16) — the feed page's Overview / Runs /
 * Delivery / Settings strip had `role="tab"` but no name, no `aria-controls`,
 * no `tabpanel` and no arrow keys. It is the kit's `Tabs` (#1445) now: a named
 * tablist, one roving tab stop, ←/→ and Home/End, and the selected section in
 * the panel its tab labels.
 */

const get = vi.fn();
const listRuns = vi.fn();

vi.mock('../../../../packages/modules/product_feeds/src/admin/api', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../packages/modules/product_feeds/src/admin/api')
  >('../../../../packages/modules/product_feeds/src/admin/api');
  return {
    ...actual,
    productFeedsClient: {
      ...actual.productFeedsClient,
      get: (id: string): Promise<{ data: ProductFeedDto }> => get(id),
      listRuns: (id: string): Promise<{ data: FeedRunDetail[] }> => listRuns(id),
      artefactUrl: (id: string): string => `/artefact/${id}`,
    },
  };
});

const { ProductFeedDetailPage } = await import(
  '../../../../packages/modules/product_feeds/src/admin/pages/ProductFeedDetailPage'
);

const FEEDS_EN = shippedModuleBundle('product_feeds', 'en').product_feeds!;
const BUNDLE = { ...shippedCoreBundle('en'), ...shippedModuleBundle('product_feeds', 'en') };

const FEED = {
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
  token: {
    prefix: '0fgh4wx9',
    rotatedAt: '2026-08-01T10:00:00.000Z',
    revokedAt: null,
    url: null,
    urlIsLive: false,
  },
  lastRun: null,
  nextRunAt: null,
  publishedArtefactId: null,
  publishedItemCount: null,
  publishedAt: null,
  isRunning: false,
  scheduleTooTightWarning: false,
  pinnedPriceBookWarning: null,
  version: 1,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
} satisfies ProductFeedDto;

function renderPage(): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/product-feeds/f1']}>
        <Routes>
          <Route path="/product-feeds/:feedId" element={<ProductFeedDetailPage />} />
        </Routes>
      </MemoryRouter>,
      {
        // Read-only: this file's subject is the strip, not the forms behind it.
        session: adminSession({ permissions: ['product_feeds:read'] }),
        presence: modulePresence({ present: ['product_feeds'] }),
      },
    ),
    BUNDLE,
  );
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: FEED });
  listRuns.mockReset().mockResolvedValue({ data: [] });
});

describe('ProductFeedDetailPage — the kit tab strip (issue #1491)', () => {
  it('renders a named tablist whose tabs control the one panel', async () => {
    const { container } = renderPage();
    const list = await screen.findByRole('tablist', { name: FEEDS_EN['feeds.tabs.label']! });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      FEEDS_EN['feeds.tab.overview'],
      FEEDS_EN['feeds.tab.runs'],
      FEEDS_EN['feeds.tab.delivery'],
      FEEDS_EN['feeds.tab.settings'],
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    for (const tab of tabs.slice(1)) expect(tab).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel');
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    await expectNoAxeViolations(container);
  });

  it('moves with the arrow keys and Home/End, the panel following the tab', async () => {
    renderPage();
    const list = await screen.findByRole('tablist');
    const [overview, runs, , settings] = within(list).getAllByRole('tab');
    const user = userEvent.setup();
    overview!.focus();
    await user.keyboard('{ArrowRight}');
    expect(runs).toHaveFocus();
    expect(runs).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', runs!.id);
    expect(await within(screen.getByRole('tabpanel')).findByText(FEEDS_EN['feeds.runs.empty.title']!)).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(settings).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', settings!.id);
    await user.keyboard('{ArrowRight}');
    expect(overview).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(settings).toHaveFocus();
  });
});
