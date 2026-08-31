import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import type { FeedTemplateSummary } from '../../../../packages/modules/product_feeds/src/admin/api';

/**
 * **The screen is `@endora-commerce/mod-product-feeds`' since feature 091's
 * Phase 4 (the plan's batch 7), so its session hooks are the kit's.** This file
 * used to replace `@/lib/auth` and `@/lib/module-presence`; both are re-export
 * shims now, and the module the screen names is
 * `@endora-commerce/admin-kit/lib`, so a mock at either old path is a no-op the
 * screen never sees. The real providers are seeded instead
 * (`helpers/render-with-session.tsx`), which is the better test anyway — a gate
 * asserted against a stub of the predicate asserts that the stub was consulted.
 *
 * `['*']` and a projection naming this module are right here because this
 * file's subject is the **layout**, not either gate; the gates are driven on
 * their own in `product-feeds.module-owned-surface.test.tsx`.
 */

/**
 * The operator's own templates are what they came here to work on; the
 * platform's are a shelf to copy from once. Putting the shelf first pushed the
 * working set below a grid of cards, so the two regions are swapped.
 */

const listTemplates = vi.fn();

vi.mock('../../../../packages/modules/product_feeds/src/admin/api', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../packages/modules/product_feeds/src/admin/api')
  >('../../../../packages/modules/product_feeds/src/admin/api');
  return {
    ...actual,
    productFeedsClient: {
      ...actual.productFeedsClient,
      listTemplates: (): Promise<{ data: FeedTemplateSummary[] }> => listTemplates(),
    },
  };
});

const bundle = passthroughBundle('product_feeds', [
  'templates.title',
  'templates.subtitle',
  'templates.provided',
  'templates.mine',
  'templates.new',
  'templates.view',
  'templates.duplicate',
  'templates.readyToUse',
  'templates.startingPoint',
  'templates.startingPoint.hint',
  'templates.fields',
  'templates.empty.mine.title',
  'templates.empty.mine.subtitle',
  'page.tabs.feeds',
  'page.tabs.templates',
  'import.action.import',
  'builder.settings.name',
  'feeds.criteria.counting',
  'permission.needWrite',
]);

const { FeedTemplatesListPage } = await import(
  '../../../../packages/modules/product_feeds/src/admin/pages/FeedTemplatesListPage'
);

function template(over: Partial<FeedTemplateSummary> & { id: string }): FeedTemplateSummary {
  return {
    name: `Template ${over.id}`,
    description: 'A description',
    providerCode: 'google',
    outputFormat: 'xml',
    itemGranularity: 'product',
    taxonomyProviderCode: null,
    isSystem: false,
    systemCode: null,
    usedByFeedCount: 0,
    fieldCount: 20,
    version: 1,
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  } as FeedTemplateSummary;
}

function renderPage(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/product-feeds/templates']}>
        <FeedTemplatesListPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['product_feeds'] }),
      },
    ),
    bundle,
  );
}

/** Document order of the two region headings. */
function headingOrder(): string[] {
  return [...document.querySelectorAll('h2')]
    .map((h) => h.textContent ?? '')
    .filter((text) => text === 'templates.mine' || text === 'templates.provided');
}

describe('FeedTemplatesListPage — region order', () => {
  beforeEach(() => {
    listTemplates.mockReset();
  });

  it('puts the operator’s own templates before the platform’s', async () => {
    listTemplates.mockResolvedValue({
      data: [template({ id: 'sys', isSystem: true }), template({ id: 'mine' })],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('templates.mine')).toBeTruthy());
    expect(headingOrder()).toEqual(['templates.mine', 'templates.provided']);
  });

  it('keeps that order when the operator has no templates of their own', async () => {
    // The empty state must not send the working region back below the shelf.
    listTemplates.mockResolvedValue({ data: [template({ id: 'sys', isSystem: true })] });
    renderPage();
    await waitFor(() => expect(screen.getByText('templates.empty.mine.title')).toBeTruthy());
    expect(headingOrder()).toEqual(['templates.mine', 'templates.provided']);
  });

  it('still renders both regions', async () => {
    listTemplates.mockResolvedValue({
      data: [template({ id: 'sys', isSystem: true }), template({ id: 'mine' })],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('templates.provided')).toBeTruthy());
    expect(screen.getByText('Template sys')).toBeTruthy();
    expect(screen.getByText('Template mine')).toBeTruthy();
  });
});
