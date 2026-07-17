import { describe, expect, it } from 'vitest';
import {
  ROW_LAYOUT_PRESETS,
  addColumnFitRow,
  addColumnFullWidth,
  applyRowLayoutPreset,
  findRowById,
  wrapRowInContentSliderSlide,
} from './row-layout-presets.js';
import type { RowProps } from '../schema/component-types.js';

const baseRow: RowProps = {
  content: [],
  sectionLayout: 'in_flow',
  contentMaxWidth: 'none',
  contentPosition: 'top',
  minHeight: 0,
  gap: 16,
  rowGap: 16,
  verticalAlign: 'stretch',
  columnDivider: false,
  reverseOnMobile: false,
  overflow: false,
};

function columnTabletSpan(span: number | { base?: number; tablet?: number; desktop?: number }): number {
  if (typeof span === 'number') return span;
  return span.tablet ?? span.desktop ?? span.base ?? 12;
}

describe('row-layout-presets', () => {
  it('creates expected column counts', () => {
    for (const preset of ROW_LAYOUT_PRESETS) {
      const next = applyRowLayoutPreset(baseRow, preset.id);
      const columns = (next.content as Array<{ type: string; props: { span: number | { tablet?: number } } }>).filter(
        (item) => item.type === 'Column',
      );
      expect(columns).toHaveLength(preset.spans.length);
      const spanSum = columns.reduce((sum, col) => sum + columnTabletSpan(col.props.span), 0);
      expect(spanSum).toBe(12);
    }
  });

  it('preserves content when reducing columns', () => {
    const row: RowProps = {
      ...baseRow,
      content: [
        { type: 'Column', props: { id: 'a', span: 6, content: [{ type: 'Text', props: { id: 't1', text: 'A' } }] } },
        { type: 'Column', props: { id: 'b', span: 6, content: [{ type: 'Text', props: { id: 't2', text: 'B' } }] } },
      ] as RowProps['content'],
    };
    const next = applyRowLayoutPreset(row, '2');
    const columns = next.content as unknown as Array<{ props: { content: Array<{ props: { text: string } }> } }>;
    expect(columns[0]?.props.content[0]?.props.text).toBe('A');
    expect(columns[1]?.props.content[0]?.props.text).toBe('B');
  });

  it('adds a fit column with spans summing to 12', () => {
    const row = applyRowLayoutPreset(baseRow, '2');
    const next = addColumnFitRow(row);
    const columns = (next.content as { type: string; props: { span: number | { tablet?: number } } }[]).filter(
      (item) => item.type === 'Column',
    );
    expect(columns).toHaveLength(3);
    const spanSum = columns.reduce((sum, col) => sum + columnTabletSpan(col.props.span), 0);
    expect(spanSum).toBe(12);
  });

  it('adds a full-width column', () => {
    const row = applyRowLayoutPreset(baseRow, '2');
    const next = addColumnFullWidth(row);
    const columns = (next.content as { type: string; props: { span: number } }[]).filter(
      (item) => item.type === 'Column',
    );
    expect(columns).toHaveLength(3);
    expect(columnTabletSpan(columns[2]?.props.span ?? 0)).toBe(12);
  });
});

describe('findRowById / wrapRowInContentSliderSlide', () => {
  it('finds a Row stored in a Puck zone (e.g. inside a Slide)', () => {
    const row = { type: 'Row', props: { id: 'r1', content: [] } };
    const data = {
      content: [{ type: 'ContentSlider', props: { id: 'cs1' } }],
      zones: {
        'cs1:slides': [{ type: 'Slide', props: { id: 's1' } }],
        's1:content': [row],
      },
    };
    expect(findRowById(data, 'r1')?.props.id).toBe('r1');

    const withRowOnSlides: { content: unknown; zones: Record<string, unknown> } = {
      content: data.content,
      zones: { 'cs1:slides': [row] },
    };
    const wrapped = wrapRowInContentSliderSlide(withRowOnSlides, 'cs1:slides', 0, row);
    const slides = wrapped.zones?.['cs1:slides'] as Array<{ type: string; props: { id: string } }>;
    expect(slides[0]?.type).toBe('Slide');
    const slideId = slides[0]?.props.id;
    expect(slideId).toBeTruthy();
    expect(wrapped.zones?.[`${slideId}:content`]).toEqual([row]);
  });
});
