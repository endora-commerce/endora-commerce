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
  const parent = getZoneParentComponentType(zone, data);
  return (parent === 'Row' || parent === 'EmailRow') && zoneSlotName(zone) === 'content';
}

/** True when the zone is a Column's `content` slot. */
export function isColumnContentZone(zone: string, data: Data): boolean {
  const parent = getZoneParentComponentType(zone, data);
  return (parent === 'Column' || parent === 'EmailColumn') && zoneSlotName(zone) === 'content';
}

/** True when the zone is a Content slider's `slides` slot. */
export function isContentSliderSlidesZone(zone: string, data: Data): boolean {
  return getZoneParentComponentType(zone, data) === 'ContentSlider' && zoneSlotName(zone) === 'slides';
}

export type PuckItemSelector = { zone?: string; index: number };

/** Content slider id when the item is a slide or nested inside a slide. */
export function resolveContentSliderIdForItem(
  itemId: string,
  getSelectorForId: (id: string) => PuckItemSelector | undefined,
  getItemById: (id: string) => PuckItem | undefined,
): string | null {
  const selector = getSelectorForId(itemId);
  if (!selector?.zone) return null;

  if (selector.zone.endsWith(':slides')) {
    const sliderId = zoneParentId(selector.zone);
    const slider = getItemById(sliderId);
    return slider?.type === 'ContentSlider' ? sliderId : null;
  }

  if (selector.zone.endsWith(':content')) {
    const parentId = zoneParentId(selector.zone);
    const parent = getItemById(parentId);
    if (parent?.type !== 'Slide') return null;
    const slideSelector = getSelectorForId(parentId);
    if (!slideSelector?.zone?.endsWith(':slides')) return null;
    const sliderId = zoneParentId(slideSelector.zone);
    const slider = getItemById(sliderId);
    return slider?.type === 'ContentSlider' ? sliderId : null;
  }

  return null;
}

/** Slide index in a content slider's `slides` zone, or null when unrelated. */
export function resolveContentSliderSlideIndex(
  itemId: string,
  sliderId: string,
  getSelectorForId: (id: string) => PuckItemSelector | undefined,
  getItemById: (id: string) => PuckItem | undefined,
): number | null {
  const slidesZone = `${sliderId}:slides`;
  const selector = getSelectorForId(itemId);
  if (!selector?.zone) return null;

  if (selector.zone === slidesZone) {
    return selector.index;
  }

  if (selector.zone.endsWith(':content')) {
    const parentId = zoneParentId(selector.zone);
    const parent = getItemById(parentId);
    if (parent?.type !== 'Slide') return null;
    const slideSelector = getSelectorForId(parentId);
    if (slideSelector?.zone !== slidesZone) return null;
    return slideSelector.index;
  }

  return null;
}

export function getZoneItems(data: Data, zone: string): PuckItem[] {
  const fromZone = toPuckItemArray(data.zones?.[zone]);
  if (fromZone.length > 0) return fromZone;
  if (zone.startsWith('root:')) return extractRootContent(data);
  return [];
}

/** Count items in a Puck slot/dropzone from persisted editor data, with live DOM fallback. */
export function getSlotZoneItemCount(data: Data, zone: string): number {
  const fromData = getZoneItems(data, zone);
  if (fromData.length > 0) return fromData.length;

  if (typeof document !== 'undefined') {
    const preview = document.querySelector('[data-puck-preview]');
    const roots: ParentNode[] = [];
    const iframe = preview?.querySelector('iframe');
    if (iframe?.contentDocument) roots.push(iframe.contentDocument);
    if (preview) roots.push(preview);
    roots.push(document);

    for (const root of roots) {
      const dropzone = root.querySelector(`[data-puck-dropzone="${CSS.escape(zone)}"]`);
      if (dropzone) return dropzone.children.length;
    }
  }

  return 0;
}

/**
 * @deprecated Puck's public API does not expose live zone indexes — use {@link getSlotZoneItemCount}.
 */
export function readPuckZoneIndexes(
  _getPuck: () => { appState: { data: Data } },
): { zones?: Record<string, { contentIds?: string[] }> } | undefined {
  return undefined;
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
    if (
      (action.componentType === 'Column' || action.componentType === 'EmailColumn') &&
      !isRowContentZone(action.destinationZone, data)
    ) {
      return true;
    }
    if (
      isContentSliderSlidesZone(action.destinationZone, data) &&
      action.componentType !== 'Slide' &&
      // Row is wrapped into a Slide in the page-builder onAction handler.
      action.componentType !== 'Row'
    ) {
      return true;
    }
    return false;
  }

  if (action.type === 'move') {
    const type = getItemTypeAtZoneIndex(sourceData, action.sourceZone, action.sourceIndex);
    if (
      (type === 'Column' || type === 'EmailColumn') &&
      !isRowContentZone(action.destinationZone, data)
    ) {
      return true;
    }
    if (
      isContentSliderSlidesZone(action.destinationZone, data) &&
      type !== 'Slide'
    ) {
      return true;
    }
    return false;
  }

  if (action.type === 'reorder') {
    const type = getItemTypeAtZoneIndex(sourceData, action.destinationZone, action.sourceIndex);
    if (
      (type === 'Column' || type === 'EmailColumn') &&
      !isRowContentZone(action.destinationZone, data)
    ) {
      return true;
    }
    if (
      isContentSliderSlidesZone(action.destinationZone, data) &&
      type !== 'Slide'
    ) {
      return true;
    }
    return false;
  }

  return false;
}

function visitItemsForColumnPlacement(items: unknown, parentType: string | null): boolean {
  for (const item of toPuckItemArray(items)) {
    if (
      (item.type === 'Column' || item.type === 'EmailColumn') &&
      parentType !== 'Row' &&
      parentType !== 'EmailRow'
    ) {
      return true;
    }

    for (const [key, value] of Object.entries(item.props)) {
      if (!Array.isArray(value)) continue;
      const childParent =
        (item.type === 'Row' || item.type === 'EmailRow') && key === 'content'
          ? item.type
          : (item.type === 'Column' || item.type === 'EmailColumn') && key === 'content'
            ? item.type
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
    const slotParent =
      (parentType === 'Row' || parentType === 'EmailRow') && zoneSlotName(zone) === 'content'
        ? parentType
        : parentType;
    if (visitItemsForColumnPlacement(zoneItems, slotParent === 'root' ? 'root' : slotParent)) {
      return true;
    }
  }

  return false;
}

export function isColumnItem(value: unknown): value is PuckItem {
  return isPuckItem(value) && value.type === 'Column';
}
