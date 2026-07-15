import type { Data, PuckAction } from '@measured/puck';
import { extractRootContent, isPuckItem, toPuckItemArray, type PuckItem } from './outline-data.js';

/** Parent component id from a Puck zone compound id (`{parentId}:{slotName}`). */
export function zoneParentId(zone: string): string {
  return zone.split(':')[0] ?? zone;
}

/** Slot prop name from a Puck zone compound id. */
export function zoneSlotName(zone: string): string {
  const parts = zone.split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : 'content';
}

function findItemById(data: Data, id: string): PuckItem | null {
  const visit = (items: PuckItem[]): PuckItem | null => {
    for (const item of items) {
      if (item.props.id === id) return item;
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

  const zones = data.zones ?? {};
  for (const zoneItems of Object.values(zones)) {
    const found = visit(toPuckItemArray(zoneItems));
    if (found) return found;
  }

  return null;
}

/** Resolve the parent component type for a zone, or `'root'` for the page root. */
export function getZoneParentComponentType(zone: string, data: Data): string {
  const parentId = zoneParentId(zone);
  if (parentId === 'root') return 'root';
  const parent = findItemById(data, parentId);
  return parent?.type ?? 'unknown';
}

/** True when the zone is a Row's `content` slot (valid Column parent). */
export function isRowContentZone(zone: string, data: Data): boolean {
  return getZoneParentComponentType(zone, data) === 'Row' && zoneSlotName(zone) === 'content';
}

/** True when the zone is a Column's `content` slot. */
export function isColumnContentZone(zone: string, data: Data): boolean {
  return getZoneParentComponentType(zone, data) === 'Column' && zoneSlotName(zone) === 'content';
}

export function getZoneItems(data: Data, zone: string): PuckItem[] {
  const fromZone = toPuckItemArray(data.zones?.[zone]);
  if (fromZone.length > 0) return fromZone;
  if (zone.startsWith('root:')) return extractRootContent(data);
  return [];
}

function getItemTypeAtZoneIndex(data: Data, zone: string, index: number): string | null {
  const items = getZoneItems(data, zone);
  return items[index]?.type ?? null;
}

/**
 * Returns true when a Puck action should be reverted — Column may only live in a
 * Row `content` slot.
 */
export function shouldRevertPuckAction(
  action: PuckAction,
  data: Data,
  prevData?: Data,
): boolean {
  const sourceData = prevData ?? data;

  if (action.type === 'insert') {
    if (action.componentType === 'Column' && !isRowContentZone(action.destinationZone, data)) {
      return true;
    }
    return false;
  }

  if (action.type === 'move') {
    const type = getItemTypeAtZoneIndex(sourceData, action.sourceZone, action.sourceIndex);
    if (type === 'Column' && !isRowContentZone(action.destinationZone, data)) {
      return true;
    }
    return false;
  }

  if (action.type === 'reorder') {
    const type = getItemTypeAtZoneIndex(sourceData, action.destinationZone, action.sourceIndex);
    if (type === 'Column' && !isRowContentZone(action.destinationZone, data)) {
      return true;
    }
    return false;
  }

  return false;
}

function visitItemsForColumnPlacement(items: unknown, parentType: string | null): boolean {
  for (const item of toPuckItemArray(items)) {
    if (item.type === 'Column' && parentType !== 'Row') {
      return true;
    }

    for (const [key, value] of Object.entries(item.props)) {
      if (!Array.isArray(value)) continue;
      const childParent =
        item.type === 'Row' && key === 'content'
          ? 'Row'
          : item.type === 'Column' && key === 'content'
            ? 'Column'
            : item.type;
      if (visitItemsForColumnPlacement(value, childParent)) {
        return true;
      }
    }
  }

  return false;
}

/** True when any Column sits outside a Row `content` slot (e.g. dropped on page root). */
export function hasInvalidColumnPlacement(data: Data): boolean {
  if (visitItemsForColumnPlacement(data.content, 'root')) {
    return true;
  }

  const zones = data.zones ?? {};
  for (const [zone, zoneItems] of Object.entries(zones)) {
    const parentType = getZoneParentComponentType(zone, data);
    const slotParent = parentType === 'Row' && zoneSlotName(zone) === 'content' ? 'Row' : parentType;
    if (visitItemsForColumnPlacement(zoneItems, slotParent === 'root' ? 'root' : slotParent)) {
      return true;
    }
  }

  return false;
}

export function isColumnItem(value: unknown): value is PuckItem {
  return isPuckItem(value) && value.type === 'Column';
}
