import type { ModuleContext } from '@endora-commerce/platform/kernel';

/**
 * `crm` — composed by the kernel container. Each area of the module registers
 * its own services, routes, subscribers and boot hooks through the same
 * `ModuleContext`, from this function's call tree.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function registerModule(_ctx: ModuleContext): void {
  // Nothing to compose yet.
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and no named class export (D-168). The platform reads this array when
 * the package is installed; a missing array is answered with zero entities
 * registered and no error anywhere.
 */
export const entities = [];
