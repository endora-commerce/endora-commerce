import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1491 (UX audit 2026-11-17, CAT-16) — the taxonomy-updates screen's
 * provider switcher (Google / Meta) was a row of bordered `role="tab"` buttons
 * with no panel, no `aria-controls` and no arrow keys. It is the kit's `Tabs`
 * (#1445) now: the design system's strip, a roving tab stop, ←/→ and Home/End,
 * and the provider's revisions in the panel the selected tab labels.
 */

const listRevisions = vi.fn();
const listChecks = vi.fn();

vi.mock('../../../../packages/modules/product_feeds/src/admin/taxonomy-api', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../packages/modules/product_feeds/src/admin/taxonomy-api')
  >('../../../../packages/modules/product_feeds/src/admin/taxonomy-api');
  return {
    ...actual,
    feedTaxonomiesClient: {
      ...actual.feedTaxonomiesClient,
      listRevisions: (code: string) => listRevisions(code),
      listChecks: (code: string) => listChecks(code),
    },
  };
});

const { TaxonomyRevisionsPage } = await import(
  '../../../../packages/modules/product_feeds/src/admin/pages/TaxonomyRevisionsPage'
);

const FEEDS_PL = shippedModuleBundle('product_feeds', 'pl').product_feeds!;
const BUNDLE = { ...shippedCoreBundle('pl'), ...shippedModuleBundle('product_feeds', 'pl') };

function renderPage(): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'pl', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={['/product-feeds/taxonomy-revisions']}>
          <TaxonomyRevisionsPage />
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      { presence: modulePresence({ present: ['product_feeds'] }), session: adminSession({ permissions: ['*'] }) },
    ),
    BUNDLE,
    { language: 'pl' },
  );
}

const emptyText = (provider: string): string =>
  FEEDS_PL['revisions.empty']!.replace('{provider}', FEEDS_PL[`revisions.provider.${provider}`]!);

beforeEach(() => {
  listRevisions.mockReset().mockResolvedValue({ data: [] });
  listChecks.mockReset().mockResolvedValue({ data: [] });
});

describe('TaxonomyRevisionsPage — the kit provider tabs (issue #1491)', () => {
  it('renders a named design-system tablist whose tabs control one panel', async () => {
    const { container } = renderPage();
    await screen.findByText(emptyText('google_merchant'));
    const list = screen.getByRole('tablist', { name: FEEDS_PL['revisions.providerTabs']! });
    expect(list).toHaveClass('b2b-tabs');
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      FEEDS_PL['revisions.provider.google_merchant'],
      FEEDS_PL['revisions.provider.meta'],
    ]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel');
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    expect(within(panel).getByText(emptyText('google_merchant'))).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('switches the provider with the arrow keys and Home/End', async () => {
    renderPage();
    await screen.findByText(emptyText('google_merchant'));
    const user = userEvent.setup();
    const [google, meta] = within(screen.getByRole('tablist')).getAllByRole('tab');
    google!.focus();
    await user.keyboard('{ArrowRight}');
    expect(meta).toHaveFocus();
    expect(meta).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(listRevisions).toHaveBeenCalledWith('meta'));
    expect(await screen.findByText(emptyText('meta'))).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', meta!.id);
    await user.keyboard('{Home}');
    expect(google).toHaveFocus();
    expect(google).toHaveAttribute('aria-selected', 'true');
  });
});
