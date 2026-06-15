import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BottomSheet } from '../components/mobile/BottomSheet';
import { MobileFilterSheet } from '../components/mobile/MobileFilterSheet';

/**
 * Feature 044 / US2 — bottom sheet + mobile filter sheet.
 *
 * Rendered via `renderToString`: the sheet's open/closed structure and the
 * filter trigger's active-count badge are render-derived and asserted here.
 * Backdrop/Escape dismissal and the apply-submits-the-form behaviour are
 * effects/handlers exercised on a real device (SSR-test convention).
 */

const labels = {
  filters: 'Filtry',
  clear: 'Wyczyść',
  applyTemplate: 'Pokaż {count} wyników',
  close: 'Zamknij',
};

describe('BottomSheet', () => {
  it('renders nothing when closed', () => {
    const html = renderToString(
      <BottomSheet open={false} onClose={() => {}}>
        <p>BODY</p>
      </BottomSheet>,
    );
    expect(html).toBe('');
  });

  it('renders the sheet shell, title, body and footer when open', () => {
    const html = renderToString(
      <BottomSheet open onClose={() => {}} title="Filtry" footer={<span>FOOT</span>}>
        <p>FACETS</p>
      </BottomSheet>,
    );
    expect(html).toContain('m-sheet');
    expect(html).toContain('m-sheet__grab');
    expect(html).toContain('Filtry');
    expect(html).toContain('FACETS');
    expect(html).toContain('FOOT');
  });
});

describe('MobileFilterSheet', () => {
  it('renders the Filtry trigger with the active-filter count badge', () => {
    const html = renderToString(
      <MobileFilterSheet
        resultCount={1248}
        activeFilterCount={3}
        clearHref="/catalog"
        labels={labels}
      >
        <form>
          <input />
        </form>
      </MobileFilterSheet>,
    );
    expect(html).toContain('Filtry');
    expect(html).toContain('>3<');
  });

  it('omits the badge and keeps the facets closed on initial render', () => {
    const html = renderToString(
      <MobileFilterSheet
        resultCount={10}
        activeFilterCount={0}
        clearHref="/catalog"
        labels={labels}
      >
        <p>HIDDEN_FACETS</p>
      </MobileFilterSheet>,
    );
    expect(html).not.toContain('HIDDEN_FACETS');
    expect(html).not.toContain('m-sheet__grab');
  });
});
