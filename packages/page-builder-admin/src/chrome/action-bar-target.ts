import { useSyncExternalStore } from 'react';

export type ActionBarTarget = { id: string; type: string };

let selectedTarget: ActionBarTarget | null = null;
let hoverTarget: ActionBarTarget | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function setSelectedActionBarTarget(next: ActionBarTarget | null): void {
  if (selectedTarget?.id === next?.id && selectedTarget?.type === next?.type) return;
  selectedTarget = next;
  notify();
}

export function setHoverActionBarTarget(next: ActionBarTarget | null): void {
  if (hoverTarget?.id === next?.id && hoverTarget?.type === next?.type) return;
  hoverTarget = next;
  notify();
}

export function getSelectedActionBarTarget(): ActionBarTarget | null {
  return selectedTarget;
}

export function getHoverActionBarTarget(): ActionBarTarget | null {
  return hoverTarget;
}

/** Selected component wins over hovered — keeps Row actions while the row stays selected. */
export function getActionBarTarget(): ActionBarTarget | null {
  return selectedTarget ?? hoverTarget;
}

export function useActionBarTarget(): ActionBarTarget | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => getActionBarTarget(),
    () => getActionBarTarget(),
  );
}
