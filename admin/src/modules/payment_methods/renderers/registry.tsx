import type { ReactNode } from 'react';
import type { AdminPaymentMethod } from '../api/payment-methods-client';

/**
 * Admin payment-method renderer registry (feature 034, FR-016/FR-017).
 *
 * An adapter may register a custom renderer for how its method appears in the
 * admin list (keyed by the adapter's `renderers.admin`). When none is
 * registered, the platform default renderer is used — so every method always
 * renders in the admin surface.
 */
export type AdminPaymentMethodRenderer = (method: AdminPaymentMethod) => ReactNode;

function pickName(name: Record<string, string>): string {
  return name['en-US'] ?? name.default ?? Object.values(name)[0] ?? '';
}

export const DefaultAdminPaymentMethodRenderer: AdminPaymentMethodRenderer = (method) => (
  <span>
    {pickName(method.name)} <code className="font-mono text-xs">({method.adapter})</code>
  </span>
);

const registry = new Map<string, AdminPaymentMethodRenderer>();

export function registerAdminPaymentMethodRenderer(
  key: string,
  renderer: AdminPaymentMethodRenderer,
): void {
  registry.set(key, renderer);
}

export function resolveAdminPaymentMethodRenderer(
  rendererKey: string | null,
): AdminPaymentMethodRenderer {
  if (rendererKey) {
    const found = registry.get(rendererKey);
    if (found) return found;
  }
  return DefaultAdminPaymentMethodRenderer;
}
