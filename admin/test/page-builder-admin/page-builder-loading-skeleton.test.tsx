import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { PageBuilderLoadingSkeleton } from '@endora-commerce/page-builder-admin';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1540 (UX audit 2026-11-17, CONTENT-23) — a page builder that is still
 * loading shows the shape of the builder it will become (blocks drawer, canvas,
 * fields panel) instead of a grey sentence over an empty bordered box. The
 * region is a polite live region marked `aria-busy`; its label is visually
 * hidden and every block is decoration.
 */
describe('PageBuilderLoadingSkeleton (#1540)', () => {
  it('is a polite, busy status region carrying its label as hidden text', () => {
    renderWithI18n(<PageBuilderLoadingSkeleton label="Loading the page builder…" />);
    const region = screen.getByRole('status');
    expect(region.contains(screen.getByText('Loading the page builder…'))).toBe(true);
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.querySelector('.sr-only')?.textContent).toBe('Loading the page builder…');
  });

  it('draws the three panes of the builder under a toolbar, with no visible sentence', () => {
    const { container } = renderWithI18n(<PageBuilderLoadingSkeleton label="Loading" />);
    const region = container.querySelector('[data-slot="page-builder-skeleton"]')!;
    for (const pane of ['toolbar', 'drawer', 'canvas', 'fields']) {
      const node = region.querySelector(`[data-pane="${pane}"]`);
      expect(node, pane).not.toBeNull();
      expect(node!.querySelectorAll('[data-slot="skeleton"]').length, pane).toBeGreaterThan(0);
    }
    // The only text is the screen-reader label: the grey sentence is gone.
    const visibleText = [...region.childNodes]
      .filter((node) => !(node instanceof HTMLElement && node.classList.contains('sr-only')))
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    expect(visibleText).toBe('');
  });

  it("falls back to the kit's loading label", () => {
    renderWithI18n(<PageBuilderLoadingSkeleton />);
    expect(screen.getByRole('status').querySelector('.sr-only')?.textContent).toBeTruthy();
  });

  it('passes axe', async () => {
    const { container } = renderWithI18n(<PageBuilderLoadingSkeleton label="Loading" />);
    await expectNoAxeViolations(container);
  });
});
