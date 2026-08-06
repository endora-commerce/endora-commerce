import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import type { FeedRunDetail, ProductFeedDto } from '../../../src/modules/product_feeds/api';

/**
 * The run history on the feed page sat on bare page background while Orders,
 * Customers, Returns and the rest all render their list inside a card, and its
 * empty state was a third hand-rolled design (`rounded-lg border border-dashed`)
 * in a module that already had `.b2b-empty`.
 *
 * Both assertions are structural on purpose: they pin *which shared surface*
 * the table lands on, which is what "matches the design system" actually means
 * here, and they keep holding through a restyle of that surface.
 */

const get = vi.fn();
const listRuns = vi.fn();

vi.mock('../../../src/modules/product_feeds/api', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/modules/product_feeds/api')
  >('../../../src/modules/product_feeds/api');
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

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

const bundle = passthroughBundle('product_feeds', [
  'page.title',
  'feeds.tab.overview',
  'feeds.tab.runs',
  'feeds.tab.settings',
  'feeds.action.generate',
  'feeds.action.download',
  'feeds.runs.empty.title',
  'feeds.runs.empty.subtitle',
  'feeds.loadFailed',
  'runs.table.startedAt',
  'runs.table.trigger',
  'runs.table.duration',
  'runs.table.emitted',
  'runs.table.skipped',
  'permission.needWrite',
]);

const { ProductFeedDetailPage } = await import(
  '../../../src/modules/product_feeds/ProductFeedDetailPage'
);

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
  },
  lastRun: null,
  nextRunAt: null,
  publishedArtefactId: null,
  publishedItemCount: null,
  publishedAt: null,
  isRunning: false,
  scheduleTooTightWarning: false,
  version: 1,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
} satisfies ProductFeedDto;

function run(): FeedRunDetail {
  return {
    id: 'r1',
    productFeedId: 'f1',
    status: 'completed',
    trigger: 'manual',
    triggeredByAdminUserId: null,
    startedAt: '2026-08-01T10:00:00.000Z',
    finishedAt: '2026-08-01T10:01:00.000Z',
    durationMs: 60_000,
    emittedCount: 12,
    skippedCount: 0,
    warningCount: 0,
    consideredCount: 12,
    failureCode: null,
    failureDetail: null,
    skipReason: null,
    issueOverflow: false,
    artefact: null,
    createdAt: '2026-08-01T10:00:00.000Z',
  } satisfies FeedRunDetail;
}

async function openRunsTab(): Promise<void> {
  renderWithI18n(
    <MemoryRouter initialEntries={['/product-feeds/f1']}>
      <Routes>
        <Route path="/product-feeds/:feedId" element={<ProductFeedDetailPage />} />
      </Routes>
    </MemoryRouter>,
    bundle,
  );
  const tab = await screen.findByRole('tab', { name: 'feeds.tab.runs' });
  await userEvent.click(tab);
}

describe('ProductFeedDetailPage — design-system alignment', () => {
  beforeEach(() => {
    get.mockReset();
    listRuns.mockReset();
    get.mockResolvedValue({ data: FEED });
  });

  it('puts the run history on the shared card surface', async () => {
    listRuns.mockResolvedValue({ data: [run()] });
    await openRunsTab();

    const table = await waitFor(() => {
      const found = document.querySelector('table');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(table.closest('.rounded-lg.border.bg-card')).not.toBeNull();
  });

  it('uses the shared .b2b-empty block instead of a hand-rolled dashed box', async () => {
    listRuns.mockResolvedValue({ data: [] });
    await openRunsTab();

    await waitFor(() => expect(screen.getByText('feeds.runs.empty.title')).toBeTruthy());
    const empty = document.querySelector('.b2b-empty');
    expect(empty).not.toBeNull();
    expect(empty?.querySelector('.b2b-empty__icon')).not.toBeNull();
    expect(empty?.closest('.rounded-lg.border.bg-card')).not.toBeNull();
    expect(document.querySelector('.border-dashed')).toBeNull();
  });
});
