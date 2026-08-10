import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import type { FeedTemplateSummary } from '../../../src/modules/product_feeds/api';

// Feature 073 — every admin surface resolves its own presence from the module
// projection. These cases are about layout and routing, not about presence, so
// the projection is stubbed as "everything is here"; the filtering itself is
// covered in AppShell.module-presence.test.tsx.
vi.mock('@/lib/module-presence', () => ({
  useModulePresence: () => ({
    modules: [],
    isPresent: () => true,
    presenceOf: () => undefined,
    isLoading: false,
    error: null,
    refresh: async () => {},
  }),
  setModuleActivation: vi.fn(),
  getModulePresence: vi.fn(),
}));

/**
 * The operator's own templates are what they came here to work on; the
 * platform's are a shelf to copy from once. Putting the shelf first pushed the
 * working set below a grid of cards, so the two regions are swapped.
 */

const listTemplates = vi.fn();

vi.mock('../../../src/modules/product_feeds/api', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/modules/product_feeds/api')
  >('../../../src/modules/product_feeds/api');
  return {
    ...actual,
    productFeedsClient: {
      ...actual.productFeedsClient,
      listTemplates: (): Promise<{ data: FeedTemplateSummary[] }> => listTemplates(),
    },
  };
});

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

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
  '../../../src/modules/product_feeds/FeedTemplatesListPage'
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
    <MemoryRouter initialEntries={['/product-feeds/templates']}>
      <FeedTemplatesListPage />
    </MemoryRouter>,
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
