import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import { BUNDLE, RFQ_ID, installGet, renderRfqDetail } from './rfq-reference-fixtures';

/**
 * Issue #1445 (UX audit 2026-11-17, DS-12) — the request's sections are the
 * kit's `RecordTabs`, not a hand-written strip: the strip is named, one tab is in
 * the tab order (roving `tabindex`), ←/→/Home/End move and select, every tab
 * controls the one panel and the panel is labelled by the selected tab. The
 * Modify draft stays mounted (hidden) inside that panel across a switch.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

const TABS_BUNDLE = {
  ...BUNDLE,
  ...passthroughBundle('quote_requests', ['detail.tabs.label']),
};

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

/** The request, with an empty history behind the History tab. */
function installRequest(): void {
  installGet(getSpy, {}, 'reject', postSpy);
  const answer = getSpy.getMockImplementation()!;
  getSpy.mockImplementation((url: string) =>
    url === `/api/v1/admin/quote-requests/${RFQ_ID}/history`
      ? Promise.resolve({ data: { entries: [] } })
      : answer(url),
  );
}

describe('RfqDetail — the sections are the kit RecordTabs (issue #1445)', () => {
  it('names the strip and links every tab to the one panel', async () => {
    installRequest();
    renderRfqDetail(RfqDetail, 'en', TABS_BUNDLE);
    const list = await screen.findByRole('tablist', { name: 'detail.tabs.label' });
    expect(list).toHaveClass('b2b-tabs');
    const overview = screen.getByRole('tab', { name: 'rfq.detail.tabs.overview' });
    expect(overview.id).toBe('rfq-detail-tab-overview');
    expect(overview).toHaveAttribute('aria-selected', 'true');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-controls', 'rfq-detail-tabpanel');
    }
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe('rfq-detail-tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'rfq-detail-tab-overview');
  });

  it('keeps one tab in the tab order and moves with the arrow keys, Home and End', async () => {
    installRequest();
    renderRfqDetail(RfqDetail, 'en', TABS_BUNDLE);
    const overview = await screen.findByRole('tab', { name: 'rfq.detail.tabs.overview' });
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toEqual([overview]);

    const user = userEvent.setup();
    overview.focus();
    await user.keyboard('{ArrowRight}');
    const modify = screen.getByRole('tab', { name: 'rfq.detail.tabs.modify' });
    expect(modify).toHaveFocus();
    expect(modify).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'rfq-detail-tab-modify');
    expect(await screen.findByRole('spinbutton', { name: 'rfq.detail.modify.agreedUnitPrice' })).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'rfq.detail.tabs.history' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'rfq-detail-tab-history');
    // The draft is kept, hidden, not exposed on another tab.
    expect(screen.queryByRole('spinbutton', { name: 'rfq.detail.modify.agreedUnitPrice' })).toBeNull();

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'rfq.detail.tabs.overview' })).toHaveFocus();
  });
});
