import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import type { ProductFeedDto } from '../../../src/modules/product_feeds/api';
import { FeedLinkCard } from '../../../src/modules/product_feeds/components/FeedLinkCard';

/**
 * The card that hands the operator the link they paste into Merchant Center.
 *
 * It used to show the URL once and mask it forever after, because the token
 * was stored only as a hash. It is now stored encrypted at rest, so the card
 * shows the real link every time — and the one case where it still cannot
 * (a token issued before that, or a deployment with no encryption key) must
 * keep the masked form rather than offering a copy button for a URL that 404s.
 */

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

const bundle = passthroughBundle('product_feeds', [
  'feeds.link.ready.title',
  'feeds.link.ready.body',
  'feeds.link.public',
  'feeds.link.masked',
  'feeds.link.copy',
  'feeds.link.copied',
  'feeds.link.rotate',
  'feeds.link.revoke',
  'feeds.action.download',
  'feeds.table.status',
  'permission.needWrite',
]);

const LIVE_URL = 'https://api.example.com/api/v1/public/product-feeds/abcdefgh12345';

function feed(token: Partial<ProductFeedDto['token']> = {}): ProductFeedDto {
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
    token: {
      prefix: 'abcdefgh',
      rotatedAt: '2026-08-01T10:00:00.000Z',
      revokedAt: null,
      url: LIVE_URL,
      urlIsLive: true,
      ...token,
    },
    lastRun: null,
    nextRunAt: null,
    // Published: the card deliberately shows no URL at all before that.
    publishedArtefactId: 'a1',
    publishedItemCount: 12,
    publishedAt: '2026-08-01T10:00:00.000Z',
    isRunning: false,
    scheduleTooTightWarning: false,
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  } satisfies ProductFeedDto;
}

function render(dto: ProductFeedDto): void {
  renderWithI18n(
    <MemoryRouter>
      <FeedLinkCard feed={dto} issuedToken={null} onChanged={() => undefined} />
    </MemoryRouter>,
    bundle,
  );
}

describe('FeedLinkCard', () => {
  it('shows the full link, absolute and unmasked, with a copy button', () => {
    render(feed());

    expect(screen.getByText(LIVE_URL)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'feeds.link.copy' })).toBeInTheDocument();
    // The two defects being fixed: a masked value, and a bare path.
    expect(screen.queryByText('feeds.link.masked')).not.toBeInTheDocument();
    expect(screen.getByText(LIVE_URL).textContent).toMatch(/^https?:\/\//);
  });

  it('falls back to the masked form when the link is not recoverable', () => {
    render(feed({ urlIsLive: false, url: null }));

    expect(screen.getByText('feeds.link.masked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'feeds.link.copy' })).not.toBeInTheDocument();
  });

  it('shows no link at all once the token is revoked', () => {
    render(feed({ revokedAt: '2026-08-02T10:00:00.000Z', url: null, urlIsLive: false }));

    expect(screen.queryByText(LIVE_URL)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'feeds.link.copy' })).not.toBeInTheDocument();
  });

  it('still warns that anyone holding the link can read the file', () => {
    render(feed());
    expect(screen.getByText('feeds.link.public')).toBeInTheDocument();
  });
});
