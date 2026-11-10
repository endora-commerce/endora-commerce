import type { CustomFieldInputSurface } from '@endora-commerce/contracts';
import { customerInputSurfacesOf } from './custom-field-registry.js';

/**
 * The storefront cache tag of one input surface's open fields (feature 175,
 * `contracts/input-surface-read.md` § Caching). The storefront reads
 * `GET /api/v1/custom-fields/input-surfaces/:surface` under it for up to 300 s.
 */
export function inputSurfaceCacheTag(surface: CustomFieldInputSurface): string {
  return `custom-fields:input-surface:${surface}`;
}

/**
 * After a committed definition or option change of `entityType`, drop the
 * storefront's cached copy of every surface that type offers, so the change
 * shows on the next page rather than after the TTL. A type that offers no
 * surface asks for nothing.
 *
 * Fire-and-forget: the revalidator bounds the call, logs a failure and never
 * throws, and an admin save must not wait on the storefront.
 */
export function inputSurfaceRevalidation(revalidator: {
  revalidate(tags: string[]): Promise<void>;
}): (entityType: string) => void {
  return (entityType) => {
    const tags = customerInputSurfacesOf(entityType).map(inputSurfaceCacheTag);
    if (tags.length > 0) void revalidator.revalidate(tags);
  };
}
