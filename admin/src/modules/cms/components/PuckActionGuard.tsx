'use client';

import { useEffect, type MutableRefObject, type ReactElement } from 'react';
import type { AppState, Data, OnAction, PuckAction } from '@measured/puck';
import { shouldRevertPuckAction, EditorCarouselPreviewBridge } from '@b2b/page-builder-core/editor';
import { usePageBuilderPuck } from '@b2b/page-builder-core/editor';

/** Captures Puck `dispatch` for the parent editor shell. */
export function PuckDispatchBridge({
  dispatchRef,
}: {
  dispatchRef: MutableRefObject<((action: PuckAction) => void) | null>;
}): null {
  const dispatch = usePageBuilderPuck((s) => s.dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch, dispatchRef]);
  return null;
}

export function createPuckActionHandler(
  dispatchRef: MutableRefObject<((action: PuckAction) => void) | null>,
  handler?: (action: PuckAction, appState: AppState<Data>, prevAppState: AppState<Data>) => void,
): OnAction {
  return (action, appState, prevAppState) => {
    if (shouldRevertPuckAction(action, appState.data, prevAppState.data)) {
      dispatchRef.current?.({
        type: 'setData',
        data: prevAppState.data,
        recordHistory: false,
      });
      return;
    }

    handler?.(action, appState, prevAppState);
  };
}

export function PuckDispatchBridgeSlot({
  dispatchRef,
  children,
}: {
  dispatchRef: MutableRefObject<((action: PuckAction) => void) | null>;
  children: React.ReactNode;
}): ReactElement {
  return (
    <>
      <PuckDispatchBridge dispatchRef={dispatchRef} />
      <EditorCarouselPreviewBridge />
      {children}
    </>
  );
}
