// Migrates legacy Puck DropZone `zones` maps into slot props (Puck 0.20+).
// React-free — safe to import from the backend content-schema-upgrader.

import type { PuckDataTree } from './envelope.js';

type PuckNode = {
  type?: string;
  props?: Record<string, unknown>;
};

function isPuckNode(value: unknown): value is PuckNode {
  return value !== null && typeof value === 'object' && typeof (value as PuckNode).type === 'string';
}

function zoneSuffix(zoneKey: string, componentId: string): string | null {
  const prefix = `${componentId}:`;
  if (!zoneKey.startsWith(prefix)) return null;
  return zoneKey.slice(prefix.length);
}

function migrateRowProps(props: Record<string, unknown>, zones: Record<string, unknown[]>): Record<string, unknown> {
  const id = typeof props['id'] === 'string' ? props['id'] : '';
  if (!id || props['content'] !== undefined) return props;
  const content = zones[`${id}:content`];
  if (!Array.isArray(content)) return props;
  return { ...props, content: migrateContentList(content, zones) };
}

function migrateColumnsProps(props: Record<string, unknown>, zones: Record<string, unknown[]>): Record<string, unknown> {
  const id = typeof props['id'] === 'string' ? props['id'] : '';
  if (!id || props['columnItems'] !== undefined) return props;

  const columnZones = Object.entries(zones)
    .map(([key, items]) => {
      const suffix = zoneSuffix(key, id);
      if (!suffix?.startsWith('column-')) return null;
      const index = Number.parseInt(suffix.slice('column-'.length), 10);
      if (!Number.isFinite(index)) return null;
      return { index, items };
    })
    .filter((entry): entry is { index: number; items: unknown[] } => entry !== null)
    .sort((a, b) => a.index - b.index);

  if (columnZones.length === 0) return props;

  return {
    ...props,
    columnItems: columnZones.map(({ items }) => ({
      content: migrateContentList(items, zones),
    })),
  };
}

function migrateNodeProps(node: PuckNode, zones: Record<string, unknown[]>): Record<string, unknown> {
  const props = { ...(node.props ?? {}) };
  if (node.type === 'Row') return migrateRowProps(props, zones);
  if (node.type === 'Columns') return migrateColumnsProps(props, zones);
  return props;
}

function migrateContentList(content: unknown[], zones: Record<string, unknown[]>): unknown[] {
  return content.map((item) => {
    if (!isPuckNode(item)) return item;
    const nextProps = migrateNodeProps(item, zones);
    const nested = nextProps['content'];
    if (Array.isArray(nested)) {
      nextProps['content'] = migrateContentList(nested, zones);
    }
    const columnItems = nextProps['columnItems'];
    if (Array.isArray(columnItems)) {
      nextProps['columnItems'] = columnItems.map((col) => {
        if (!col || typeof col !== 'object') return col;
        const colObj = col as Record<string, unknown>;
        const colContent = colObj['content'];
        if (Array.isArray(colContent)) {
          return { ...colObj, content: migrateContentList(colContent, zones) };
        }
        return colObj;
      });
    }
    return { ...item, props: nextProps };
  });
}

/**
 * Rewrites a single-language Puck tree from legacy `zones` storage into slot
 * props on Row/Columns nodes. Idempotent when `zones` is empty or slots already
 * exist.
 */
export function migratePuckTreeZonesToSlots(tree: PuckDataTree): PuckDataTree {
  const zones =
    tree.zones && typeof tree.zones === 'object'
      ? (tree.zones as Record<string, unknown[]>)
      : {};
  if (Object.keys(zones).length === 0) {
    return tree;
  }

  const content = Array.isArray(tree.content) ? tree.content : [];
  return {
    ...tree,
    content: migrateContentList(content, zones),
    zones: {},
  };
}
