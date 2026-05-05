import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ParametryTab } from '../../components/attributes/ParametryTab';

/**
 * Feature 012 / US6 — SSR contract for the "Parametry produktu" tab.
 *
 * The component is a thin renderer over the backend's
 * `visibleAttributes[]` projection. The backend already filters by
 * `isVisibleOnProductPage` AND `has_value`, and resolves per-locale
 * option labels. This suite asserts:
 *   1. The tab is OMITTED entirely when the projection is empty
 *      (FR-030) — returns the empty string from renderToString.
 *   2. The tab renders a label/value table when items are present.
 *   3. Per-locale tab title comes from the i18n catalogue.
 */

describe('ParametryTab — SSR rendering', () => {
  it('renders nothing when the projection is empty', () => {
    expect(renderToString(<ParametryTab attributes={[]} locale="en-US" />)).toBe('');
    expect(renderToString(<ParametryTab attributes={null} locale="en-US" />)).toBe('');
    expect(renderToString(<ParametryTab attributes={undefined} locale="en-US" />)).toBe('');
  });

  it('renders a labelled table for the visible attributes', () => {
    const html = renderToString(
      <ParametryTab
        locale="en-US"
        attributes={[
          { key: 'gear_ratio', label: 'Gear ratio', valueType: 'number', valueRendered: '1:30' },
          { key: 'material', label: 'Material', valueType: 'select', valueRendered: 'Brass' },
        ]}
      />,
    );
    expect(html).toContain('Specifications');
    expect(html).toContain('Gear ratio');
    expect(html).toContain('1:30');
    expect(html).toContain('Material');
    expect(html).toContain('Brass');
    // Two rows in the body table (one per visible attribute).
    expect(html.match(/<tr/g)?.length ?? 0).toBe(2);
  });

  it('uses the Polish tab title for the pl-PL locale', () => {
    const html = renderToString(
      <ParametryTab
        locale="pl-PL"
        attributes={[{ key: 'kolor', label: 'Kolor', valueType: 'select', valueRendered: 'Czerwony' }]}
      />,
    );
    expect(html).toContain('Parametry produktu');
    expect(html).toContain('Kolor');
    expect(html).toContain('Czerwony');
  });
});
