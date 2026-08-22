'use client';

import { useLayoutEffect, useRef, type PointerEvent, type ReactElement } from 'react';
import { registerOverlayPortal, useGetPuck } from '@measured/puck';
import { GripVertical } from 'lucide-react';
import {
  getSlotZoneItemCount,
  outlineStepReorder,
  resolvePuckDndElement,
  usePageBuilderPuck,
} from '@endora-commerce/page-builder-core/editor';
import { QuickTooltip } from './QuickTooltip';

const REORDER_STEP_PX = 24;

function isHorizontalReorderZone(zone: string): boolean {
  return zone.endsWith(':slides');
}

type PointerLike = {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  button: number;
  buttons: number;
  pressure: number;
  width: number;
  height: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

function relayPointer(target: HTMLElement, type: string, source: PointerLike): void {
  target.dispatchEvent(
    new globalThis.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: source.pointerId,
      pointerType: source.pointerType,
      isPrimary: source.isPrimary,
      clientX: source.clientX,
      clientY: source.clientY,
      screenX: source.screenX,
      screenY: source.screenY,
      button: source.button,
      buttons: source.buttons,
      pressure: source.pressure,
      width: source.width,
      height: source.height,
      altKey: source.altKey,
      ctrlKey: source.ctrlKey,
      metaKey: source.metaKey,
      shiftKey: source.shiftKey,
    }),
  );
}

/** Grip control — relays pointer capture to Puck's sortable wrapper, else step-reorder. */
export function ComponentDragHandle({ componentId }: { componentId: string }): ReactElement {
  const handleRef = useRef<HTMLButtonElement>(null);
  const getPuck = useGetPuck();
  const getSelectorForId = usePageBuilderPuck((s) => s.getSelectorForId);

  useLayoutEffect(() => {
    return registerOverlayPortal(handleRef.current, { disableDrag: true, disableDragOnFocus: true });
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    const selector = getSelectorForId(componentId);
    if (!selector) return;

    event.preventDefault();
    event.stopPropagation();

    const dndEl = resolvePuckDndElement(componentId);
    if (dndEl) {
      const pointerId = event.pointerId;
      relayPointer(dndEl, 'pointerdown', event);
      dndEl.setPointerCapture(pointerId);

      const forward = (e: globalThis.PointerEvent): void => {
        if (e.pointerId !== pointerId) return;
        relayPointer(dndEl, e.type, e);
      };

      const finish = (e: globalThis.PointerEvent): void => {
        if (e.pointerId !== pointerId) return;
        relayPointer(dndEl, e.type, e);
        dndEl.releasePointerCapture(pointerId);
        window.removeEventListener('pointermove', forward);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
      };

      window.addEventListener('pointermove', forward);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      return;
    }

    const horizontal = isHorizontalReorderZone(selector.zone);
    const pointerId = event.pointerId;
    const start = horizontal ? event.clientX : event.clientY;
    let lastStep = 0;

    handleRef.current?.setPointerCapture(pointerId);

    const reorderStep = (direction: -1 | 1): void => {
      const puck = getPuck();
      const current = puck.getSelectorForId(componentId);
      if (!current) return;
      const action = outlineStepReorder(
        {
          itemId: componentId,
          sourceZone: current.zone,
          sourceIndex: current.index,
        },
        current.zone,
        direction,
        getSlotZoneItemCount(puck.appState.data, current.zone),
      );
      if (action) puck.dispatch(action);
    };

    const onMove = (e: globalThis.PointerEvent): void => {
      if (e.pointerId !== pointerId) return;
      const pos = horizontal ? e.clientX : e.clientY;
      const step = Math.trunc((pos - start) / REORDER_STEP_PX);
      if (step === lastStep) return;

      const direction: -1 | 1 = step > lastStep ? 1 : -1;
      const steps = Math.abs(step - lastStep);
      for (let i = 0; i < steps; i++) {
        reorderStep(direction);
      }
      lastStep = step;
    };

    const finish = (e: globalThis.PointerEvent): void => {
      if (e.pointerId !== pointerId) return;
      handleRef.current?.releasePointerCapture(pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  return (
    <QuickTooltip text="Drag to move">
      <button
        ref={handleRef}
        type="button"
        className="_ActionBar-action_rvadt_30 pb-action-bar-handle"
        aria-label="Drag to move"
        onPointerDown={onPointerDown}
      >
        <GripVertical size={16} />
      </button>
    </QuickTooltip>
  );
}
