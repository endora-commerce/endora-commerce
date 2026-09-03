import type { EmailColumnProps, EmailRowProps } from '../schema/component-types.js';

export type EmailRowLayoutPresetId = '1' | '2' | '3' | '4' | '5' | '6';

export interface EmailRowLayoutPreset {
  id: EmailRowLayoutPresetId;
  label: string;
  /** Width spans on a 12-column grid (sum to 12). */
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

export const EMAIL_ROW_LAYOUT_PRESETS: EmailRowLayoutPreset[] = [
  { id: '1', label: '1 column', spans: [12] },
  { id: '2', label: '2 columns', spans: [6, 6] },
  { id: '3', label: '3 columns', spans: [4, 4, 4] },
  { id: '4', label: '4 columns', spans: [3, 3, 3, 3] },
  { id: '5', label: '5 columns', spans: [3, 3, 2, 2, 2] },
  { id: '6', label: '6 columns', spans: [2, 2, 2, 2, 2, 2] },
];

export function createDefaultEmailColumnItem(
  id: string,
  span = 6,
): { type: 'transactional_emails.EmailColumn'; props: EmailColumnProps & { id: string } } {
  return {
    type: 'transactional_emails.EmailColumn',
    props: {
      id,
      span,
      content: [],
    },
  };
}

function existingColumnContents(content: unknown): PuckItem[][] {
  return toPuckItemArray(content)
    .filter((item) => item.type === 'transactional_emails.EmailColumn')
    .map((col) => toPuckItemArray(col.props.content));
}

function buildColumns(spans: number[], preserved: PuckItem[][]): PuckItem[] {
  return spans.map((span, index) => {
    const col = createDefaultEmailColumnItem(`ecol-${crypto.randomUUID()}`, span);
    return {
      ...col,
      props: {
        ...col.props,
        span,
        content: preserved[index] ?? [],
      },
    };
  });
}

/** Apply a column layout preset, preserving nested block data where possible. */
export function applyEmailRowLayoutPreset(
  rowProps: EmailRowProps,
  presetId: EmailRowLayoutPresetId,
): EmailRowProps {
  const preset = EMAIL_ROW_LAYOUT_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) return rowProps;
  const preserved = existingColumnContents(rowProps.content);
  return {
    ...rowProps,
    content: buildColumns(preset.spans, preserved) as EmailRowProps['content'],
  };
}

/** Add one column and redistribute equal-ish spans (max 6). */
export function addEmailColumnFitRow(rowProps: EmailRowProps): EmailRowProps {
  const columns = toPuckItemArray(rowProps.content).filter((item) => item.type === 'transactional_emails.EmailColumn');
  if (columns.length >= 6) return rowProps;
  const preserved = columns.map((col) => toPuckItemArray(col.props.content));
  const nextCount = columns.length + 1;
  const base = Math.floor(12 / nextCount);
  const remainder = 12 - base * nextCount;
  const spans = Array.from({ length: nextCount }, (_, index) => base + (index < remainder ? 1 : 0));
  return {
    ...rowProps,
    content: buildColumns(spans, [...preserved, []]) as EmailRowProps['content'],
  };
}

export function findEmailRowById(
  data: { content?: unknown; zones?: Record<string, unknown> },
  rowId: string,
): PuckItem | null {
  const visit = (items: PuckItem[]): PuckItem | null => {
    for (const item of items) {
      if (item.type === 'transactional_emails.EmailRow' && item.props.id === rowId) return item;
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

  const root = visit(toPuckItemArray(data.content));
  if (root) return root;
  for (const zoneItems of Object.values(data.zones ?? {})) {
    const found = visit(toPuckItemArray(zoneItems));
    if (found) return found;
  }
  return null;
}

export function replaceEmailRowInData<T extends { content?: unknown; zones?: Record<string, unknown> }>(
  data: T,
  rowId: string,
  nextRow: PuckItem,
): T {
  const mapItems = (items: PuckItem[]): PuckItem[] =>
    items.map((item) => {
      if (item.type === 'transactional_emails.EmailRow' && item.props.id === rowId) {
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

  const previousColumns = toPuckItemArray(
    (data.zones ?? {})[`${rowId}:content`] ?? findEmailRowById(data, rowId)?.props.content ?? [],
  );
  const columns = toPuckItemArray(nextRow.props.content);
  const nextColumnIds = new Set(
    columns
      .filter((col) => col.type === 'transactional_emails.EmailColumn' && typeof col.props.id === 'string')
      .map((col) => col.props.id as string),
  );
  for (const col of previousColumns) {
    if (col.type !== 'transactional_emails.EmailColumn' || typeof col.props.id !== 'string') continue;
    if (!nextColumnIds.has(col.props.id)) {
      delete nextZones[`${col.props.id}:content`];
    }
  }

  nextZones[`${rowId}:content`] = columns;
  for (const col of columns) {
    if (col.type !== 'transactional_emails.EmailColumn' || typeof col.props.id !== 'string') continue;
    nextZones[`${col.props.id}:content`] = toPuckItemArray(col.props.content);
  }

  return {
    ...data,
    content: mapItems(toPuckItemArray(data.content)),
    zones: nextZones,
  };
}
