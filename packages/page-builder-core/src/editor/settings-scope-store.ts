import type { SettingsScope } from '../types/responsive.js';

const scopeByComponentId = new Map<string, SettingsScope>();
const listeners = new Set<() => void>();

export function getStoredScope(componentId: string | undefined): SettingsScope {
  if (!componentId) return 'base';
  return scopeByComponentId.get(componentId) ?? 'base';
}

export function setStoredScope(componentId: string | undefined, scope: SettingsScope): void {
  if (!componentId) return;
  scopeByComponentId.set(componentId, scope);
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
