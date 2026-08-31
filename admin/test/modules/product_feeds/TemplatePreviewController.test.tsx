import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import {
  TemplatePreviewController,
  TemplatePreviewVerdict,
  type PreviewSelection,
} from '../../../../packages/modules/product_feeds/src/admin/components/TemplatePreviewController';
import type { TemplatePreview } from '../../../../packages/modules/product_feeds/src/admin/api';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * The preview controller sits in `PageHeader`'s `actions` slot — a
 * `flex flex-wrap items-center` row of buttons. It used to render the verdict
 * banner from that same fragment, so switching the preview on injected a
 * full-width `Alert` into the button row: it became a flex item, was
 * vertically centred against the Save button and its `mt-3` did nothing.
 *
 * Controls belong in the header; the result belongs in the page body. The
 * controller no longer accepts the preview payload at all, so `tsc` now guards
 * half of this — these tests pin the other half, that nothing it *does* receive
 * can put a banner back into the button row.
 */

const bundle = passthroughBundle('product_feeds', [
  'builder.preview.on',
  'builder.preview.off',
  'builder.preview.clear',
  'builder.preview.verdict.included',
  'builder.preview.verdict.skipped',
  'builder.preview.failed',
]);

const SELECTION: PreviewSelection = {
  productId: 'p1',
  sku: 'SKU-1',
  name: 'A product',
};

function previewFixture(over: Partial<TemplatePreview> = {}): TemplatePreview {
  return {
    fields: [],
    wouldEmitItem: true,
    skipReason: null,
    renderedItem: '<item></item>',
    resolvedContext: {
      salesChannelId: 'sc1',
      languageCode: 'pl',
      currencyCode: 'PLN',
      priceListId: null,
      pricePresentation: 'net',
      taxCountry: null,
    },
    ...over,
  } as TemplatePreview;
}

describe('TemplatePreviewController — header controls only', () => {
  it('renders no alert while the preview is off', () => {
    renderWithI18n(
      <TemplatePreviewController
        selection={null}
        onSelect={vi.fn()}
      />,
      bundle,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders no alert once the preview is on — the verdict is not a header control', () => {
    renderWithI18n(
      <TemplatePreviewController
        selection={SELECTION}
        onSelect={vi.fn()}
      />,
      bundle,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still offers the toggle and the clear control', () => {
    renderWithI18n(
      <TemplatePreviewController
        selection={SELECTION}
        onSelect={vi.fn()}
      />,
      bundle,
    );
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('builder.preview.clear')).toBeTruthy();
  });
});

describe('TemplatePreviewVerdict — the body-level result', () => {
  it('states the included verdict', () => {
    renderWithI18n(
      <TemplatePreviewVerdict
        selection={SELECTION}
        preview={previewFixture()}
        loading={false}
        error={null}
      />,
      bundle,
    );
    expect(screen.getByRole('alert').textContent).toContain('builder.preview.verdict.included');
  });

  it('states the skipped verdict', () => {
    renderWithI18n(
      <TemplatePreviewVerdict
        selection={SELECTION}
        preview={previewFixture({ wouldEmitItem: false, skipReason: 'missing_image' })}
        loading={false}
        error={null}
      />,
      bundle,
    );
    expect(screen.getByRole('alert').textContent).toContain('builder.preview.verdict.skipped');
  });

  it('shows the error instead of a verdict', () => {
    renderWithI18n(
      <TemplatePreviewVerdict
        selection={SELECTION}
        preview={null}
        loading={false}
        error="boom"
      />,
      bundle,
    );
    expect(screen.getByRole('alert').textContent).toContain('boom');
  });

  it('renders nothing while the preview is off', () => {
    const { container } = renderWithI18n(
      <TemplatePreviewVerdict selection={null} preview={null} loading={false} error={null} />,
      bundle,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while a fresh preview is still loading', () => {
    // A stale verdict next to an edited template is worse than no verdict.
    const { container } = renderWithI18n(
      <TemplatePreviewVerdict
        selection={SELECTION}
        preview={previewFixture()}
        loading
        error={null}
      />,
      bundle,
    );
    expect(container.innerHTML).toBe('');
  });
});
