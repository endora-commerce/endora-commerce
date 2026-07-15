import type { Data, PuckAction } from '@measured/puck';
import { getZoneItems, shouldRevertPuckAction } from './puck-action-guards.js';

export interface OutlineDropPayload {
  itemId: string;
  sourceZone: string;
  sourceIndex: number;
}

export function canOutlineDrop(
  payload: OutlineDropPayload,
  targetItemId: string,
  targetZone: string,
  targetIndex: number,
  data: Data,
): boolean {
  if (payload.itemId === targetItemId) return false;

  const moveAction: PuckAction = {
    type: 'move',
    sourceZone: payload.sourceZone,
    sourceIndex: payload.sourceIndex,
    destinationZone: targetZone,
    destinationIndex: targetIndex,
  };

  return !shouldRevertPuckAction(moveAction, data);
}

/** Move one position up/down within the same zone (outline arrow buttons). */
export function outlineStepReorder(
  payload: OutlineDropPayload,
  zone: string,
  direction: -1 | 1,
  siblingCount: number,
): PuckAction | null {
  const destinationIndex = payload.sourceIndex + direction;
  if (destinationIndex < 0 || destinationIndex >= siblingCount) return null;

  return {
    type: 'reorder',
    sourceIndex: payload.sourceIndex,
    destinationIndex,
    destinationZone: zone,
  };
}

/** Drop dragged outline item before the target row (HTML5 DnD). */
export function outlineDropBeforeTarget(
  payload: OutlineDropPayload,
  targetZone: string,
  targetIndex: number,
): PuckAction {
  if (payload.sourceZone === targetZone) {
    let destinationIndex = targetIndex;
    if (payload.sourceIndex < targetIndex) {
      destinationIndex -= 1;
    }
    return {
      type: 'reorder',
      sourceIndex: payload.sourceIndex,
      destinationIndex,
      destinationZone: targetZone,
    };
  }

  return {
    type: 'move',
    sourceZone: payload.sourceZone,
    sourceIndex: payload.sourceIndex,
    destinationZone: targetZone,
    destinationIndex: targetIndex,
  };
}

/** @deprecated Use outlineDropBeforeTarget or outlineStepReorder */
export function outlineReorderAction(
  payload: OutlineDropPayload,
  targetZone: string,
  targetIndex: number,
): PuckAction {
  return outlineDropBeforeTarget(payload, targetZone, targetIndex);
}

export function outlineSiblingCount(data: Data, zone: string): number {
  return getZoneItems(data, zone).length;
}
