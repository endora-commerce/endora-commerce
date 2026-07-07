export type SettingsTab = 'general' | 'responsive';

const tabByComponentId = new Map<string, SettingsTab>();
const listeners = new Set<() => void>();

export function getStoredSettingsTab(componentId: string | undefined): SettingsTab {
  if (!componentId) return 'general';
  return tabByComponentId.get(componentId) ?? 'general';
}

export function setStoredSettingsTab(componentId: string | undefined, tab: SettingsTab): void {
  if (!componentId) return;
  tabByComponentId.set(componentId, tab);
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSettingsTab(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
