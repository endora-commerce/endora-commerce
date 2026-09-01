import type { ReactNode } from 'react';
import type { AdminDeliveryMethod } from '../api/delivery-methods-client.js';

/**
 * Admin shipping-method renderer registry (feature 035, FR-016/FR-017).
 *
 * An adapter may register a custom renderer for how its method appears in the
 * admin list (keyed by the adapter's `renderers.admin`). When none is
 * registered, the platform default renderer is used — so every method always
 * renders in the admin surface.
 */
export type AdminDeliveryMethodRenderer = (method: AdminDeliveryMethod) => ReactNode;

function pickName(name: Record<string, string>): string {
  return name['en-US'] ?? name.default ?? Object.values(name)[0] ?? '';
}

export const DefaultAdminDeliveryMethodRenderer: AdminDeliveryMethodRenderer = (method) => (
  <span>
    {pickName(method.name)} <code className="font-mono text-xs">({method.adapter})</code>
  </span>
);

const registry = new Map<string, AdminDeliveryMethodRenderer>();

export function registerAdminDeliveryMethodRenderer(
  key: string,
  renderer: AdminDeliveryMethodRenderer,
): void {
  registry.set(key, renderer);
}

export function resolveAdminDeliveryMethodRenderer(
  rendererKey: string | null,
): AdminDeliveryMethodRenderer {
  if (rendererKey) {
    const found = registry.get(rendererKey);
    if (found) return found;
  }
  return DefaultAdminDeliveryMethodRenderer;
}
