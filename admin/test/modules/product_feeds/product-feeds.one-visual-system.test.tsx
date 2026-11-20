import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import type { ProductFeedDto } from '../../../../packages/modules/product_feeds/src/admin/api';

/**
 * Issue #1492 (UX audit CAT-17): the product feeds screens move from the
 * legacy `b2b-*` classes to the kit's `ui/*` primitives. What changes for an
 * operator, beyond the look, is pinned here:
 *
 * - the sample-product picker's search box has a name, not only a placeholder
 *   (WCAG 4.1.2), its loading line is a `status` and a failure is an `alert`
 *   (WCAG 4.1.3);
 * - a download the operator may not take is a disabled button, not a link
 *   made unclickable with `pointer-events: none`, which a keyboard could still
 *   follow (WCAG 2.1.1);
 * - the template export is a kit button, so it looks like the button beside it
 *   (Law of Similarity).
 */

const get = vi.fn();
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return { ...actual, apiClient: { get: (...args: unknown[]) => get(...args) } };
});

const { TemplatePreviewController } = await import(
  '../../../../packages/modules/product_feeds/src/admin/components/TemplatePreviewController'
);
const { FeedLinkCard } = await import(
  '../../../../packages/modules/product_feeds/src/admin/components/FeedLinkCard'
);

const bundle = passthroughBundle('product_feeds', [
  'builder.preview.off',
  'builder.preview.pick',
  'builder.preview.search',
  'builder.preview.loading',
  'builder.preview.failed',
  'builder.help.pickProduct',
  'builder.inspector.close',
  'feeds.link.ready.title',
  'feeds.link.ready.body',
  'feeds.link.public',
  'feeds.link.masked',
  'feeds.link.copy',
  'feeds.link.rotate',
  'feeds.link.revoke',
  'feeds.action.download',
  'feeds.table.status',
  'permission.needWrite',
]);

beforeEach(() => {
  get.mockReset();
});

describe('sample-product picker (#1492)', () => {
  function open(): void {
    renderWithI18n(<TemplatePreviewController selection={null} onSelect={vi.fn()} />, bundle);
    fireEvent.click(screen.getByRole('button', { name: 'builder.preview.off' }));
  }

  it('names its search box and announces the load', async () => {
    get.mockReturnValue(new Promise(() => undefined));
    open();
    expect(screen.getByRole('searchbox', { name: 'builder.preview.search' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('builder.preview.loading');
  });

  it('reports a failed load as an alert', async () => {
    get.mockImplementation(() => Promise.reject(new Error('down')));
    open();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('builder.preview.failed'));
  });

  it('draws the search with kit classes, not b2b-field', async () => {
    get.mockReturnValue(new Promise(() => undefined));
    open();
    expect(screen.getByRole('searchbox').className).not.toMatch(/\bb2b-/);
  });
});

function feed(): ProductFeedDto {
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
      url: 'https://api.example.com/api/v1/public/product-feeds/abcdefgh12345',
      urlIsLive: true,
    },
    lastRun: null,
    nextRunAt: null,
    publishedArtefactId: 'a1',
    publishedItemCount: 12,
    publishedAt: '2026-08-01T10:00:00.000Z',
    isRunning: false,
    scheduleTooTightWarning: false,
    pinnedPriceBookWarning: null,
    version: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  } satisfies ProductFeedDto;
}

function renderCard(permissions: string[]): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <FeedLinkCard feed={feed()} issuedToken={null} onChanged={() => undefined} />
      </MemoryRouter>,
      { session: adminSession({ permissions }) },
    ),
    bundle,
  );
}

describe('feed link card download (#1492)', () => {
  it('is a link for an operator who may download', () => {
    renderCard(['*']);
    const link = screen.getByRole('link', { name: 'feeds.action.download' });
    expect(link.getAttribute('href')).toMatch(/f1/);
    expect(link.className).not.toMatch(/\bb2b-/);
  });

  it('is a disabled button, not a followable link, for a read-only operator', () => {
    renderCard(['product_feeds:read']);
    expect(screen.queryByRole('link', { name: 'feeds.action.download' })).toBeNull();
    const button = screen.getByRole('button', { name: 'feeds.action.download' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toBe('permission.needWrite');
  });
});
