import type { ResponsiveProp } from '@endora-commerce/page-builder-core';
import type { RowProps } from '../schema/component-types.js';
import { createDefaultColumnItem } from '../components/Column.js';

export type RowLayoutPresetId = '1' | '2' | '3' | '4' | '5' | '6' | '12';

export interface RowLayoutPreset {
  id: RowLayoutPresetId;
  label: string;
  spans: number[];
}

type PuckItem = { type: string; props: Record<string, unknown> };

function toPuckItemArray(value: unknown): PuckItem[] {
  if (!Array.isArray(value)) return [];
  const items: PuckItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.type === 'string' && record.props && typeof record.props === 'object') {
      items.push({ type: record.type, props: record.props as Record<string, unknown> });
    }
  }
  return items;
}

export const ROW_LAYOUT_PRESETS: RowLayoutPreset[] = [
  { id: '1', label: '1 column', spans: [12] },
  { id: '2', label: '2 columns', spans: [6, 6] },
  { id: '3', label: '3 columns', spans: [4, 4, 4] },
  { id: '4', label: '4 columns', spans: [3, 3, 3, 3] },
  { id: '5', label: '5 columns', spans: [3, 3, 2, 2, 2] },
  { id: '6', label: '6 columns', spans: [2, 2, 2, 2, 2, 2] },
  { id: '12', label: '12 columns', spans: Array.from({ length: 12 }, () => 1) },
];

export const ROW_PRESET_DEFAULTS: Pick<RowProps, 'sectionLayout' | 'gap' | 'rowGap'> = {
  sectionLayout: 'in_flow',
  gap: 24,
  rowGap: 24,
};

function existingColumnContents(content: unknown): PuckItem[][] {
  return toPuckItemArray(content)
    .filter((item) => item.type === 'Column')
    .map((col) => toPuckItemArray(col.props.content));
}

function responsiveColumnSpan(tabletSpan: number): number | ResponsiveProp<number> {
  return { base: 12, tablet: tabletSpan, desktop: tabletSpan };
}

function buildColumns(spans: number[], preserved: PuckItem[][]): PuckItem[] {
  return spans.map((span, index) => {
    const col = createDefaultColumnItem(`col-${crypto.randomUUID()}`);
    return {
      ...col,
      props: {
        ...col.props,
        span: responsiveColumnSpan(span),
        content: preserved[index] ?? [],
      },
    };
  });
}

/** Apply a column layout preset to a Row's `content` slot, preserving block data where possible. */
export function applyRowLayoutPreset(
  rowProps: RowProps,
  presetId: RowLayoutPresetId,
): RowProps {
  const preset = ROW_LAYOUT_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) return rowProps;

  const preserved = existingColumnContents(rowProps.content);
  return {
    ...rowProps,
    ...ROW_PRESET_DEFAULTS,
    content: buildColumns(preset.spans, preserved) as RowProps['content'],
  };
}

/** Add one column and redistribute spans so they sum to 12 on one row. */
export function addColumnFitRow(rowProps: RowProps): RowProps {
  const columns = toPuckItemArray(rowProps.content).filter((item) => item.type === 'Column');
  const preserved = columns.map((col) => toPuckItemArray(col.props.content));
  const nextCount = columns.length + 1;
  const base = Math.floor(12 / nextCount);
  const remainder = 12 - base * nextCount;
  const spans = Array.from({ length: nextCount }, (_, index) => base + (index < remainder ? 1 : 0));

  return {
    ...rowProps,
    content: buildColumns(spans, [...preserved, []]) as RowProps['content'],
  };
}

/** Append a full-width column (span 12) that wraps to a new grid row. */
export function addColumnFullWidth(rowProps: RowProps): RowProps {
  const columns = toPuckItemArray(rowProps.content).filter((item) => item.type === 'Column');
  const col = createDefaultColumnItem(`col-${crypto.randomUUID()}`);
  const fullWidthCol: PuckItem = {
    ...col,
    props: { ...col.props, span: responsiveColumnSpan(12), content: [] },
  };

  return {
    ...rowProps,
    content: [...columns, fullWidthCol] as RowProps['content'],
  };
}

export function findRowById(
  data: { content?: unknown; zones?: Record<string, unknown> },
  rowId: string,
): PuckItem | null {
  const visit = (items: PuckItem[]): PuckItem | null => {
    for (const item of items) {
      if (item.type === 'Row' && item.props.id === rowId) return item;
      for (const value of Object.values(item.props)) {
        const nested = toPuckItemArray(value);
        if (nested.length > 0) {
          const found = visit(nested);
          if (found) return found;
        }
      }
    }
    return null;
  };

  const fromContent = visit(toPuckItemArray(data.content));
  if (fromContent) return fromContent;

  for (const zoneItems of Object.values(data.zones ?? {})) {
    const found = visit(toPuckItemArray(zoneItems));
    if (found) return found;
  }

  return null;
}

export function replaceRowInData<T extends { content?: unknown; zones?: Record<string, unknown> }>(
  data: T,
  rowId: string,
  nextRow: PuckItem,
): T {
  const mapItems = (items: PuckItem[]): PuckItem[] =>
    items.map((item) => {
      if (item.type === 'Row' && item.props.id === rowId) {
        return nextRow;
      }
      const nextProps: Record<string, unknown> = { ...item.props };
      for (const [key, value] of Object.entries(item.props)) {
        const nested = toPuckItemArray(value);
        if (nested.length > 0) {
          nextProps[key] = mapItems(nested);
        }
      }
      return { ...item, props: nextProps };
    });

  const nextZones: Record<string, unknown> = { ...(data.zones ?? {}) };
  for (const [zone, items] of Object.entries(nextZones)) {
    nextZones[zone] = mapItems(toPuckItemArray(items));
  }

  const columns = toPuckItemArray(nextRow.props.content);
  nextZones[`${rowId}:content`] = columns;
  for (const col of columns) {
    if (col.type !== 'Column' || typeof col.props.id !== 'string') continue;
    nextZones[`${col.props.id}:content`] = toPuckItemArray(col.props.content);
  }

  return {
    ...data,
    content: mapItems(toPuckItemArray(data.content)),
    zones: nextZones,
  };
}

/** Turn a Row that landed in a Content slider `:slides` zone into Slide → Row. */
export function wrapRowInContentSliderSlide<T extends { content?: unknown; zones?: Record<string, unknown> }>(
  data: T,
  slidesZone: string,
  index: number,
  row: PuckItem,
): T {
  const slides = [...toPuckItemArray(data.zones?.[slidesZone])];
  if (slides[index]?.type !== 'Row') return data;

  const slideId = `slide-${crypto.randomUUID()}`;
  const slide: PuckItem = {
    type: 'Slide',
    props: {
      id: slideId,
      content: [],
      margin: { mode: 'uniform', value: 0 },
      padding: { mode: 'uniform', value: 0 },
      border: { mode: 'none' },
      background: { kind: 'none' },
      cornerRadius: 'none',
      shadow: 'none',
    },
  };
  slides[index] = slide;

  return {
    ...data,
    zones: {
      ...(data.zones ?? {}),
      [slidesZone]: slides,
      [`${slideId}:content`]: [row],
    },
  };
}
