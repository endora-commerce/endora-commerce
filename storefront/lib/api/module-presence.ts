import type { StorefrontModulePresenceResponse } from '@endora-commerce/contracts';
import { apiGet, type RequestContext } from './client';

/**
 * The storefront's effective enabled-set — feature 073, FR-030 / FR-035.
 *
 * Resolved once per request in `getServerContext()` and threaded down, so a
 * page renders a module's contribution only when the platform actually offers
 * it. Absence is **projected**: the component is not rendered at all, rather
 * than rendered and then fed a default because its API answered 503.
 *
 * Cached under the Next tag `modules:presence` and invalidated by the backend's
 * existing revalidator on every activation flip and every lifecycle transition,
 * so a toggle takes effect on the next request without a rebuild or a cache
 * flush (FR-036). The TTL is the backstop, not the mechanism — no page gets
 * slower because of this fetch.
 */
export const MODULE_PRESENCE_TAG = 'modules:presence';

export interface ModulePresenceSet {
  /** `true` when the platform offers this module and the operator wants it. */
  isPresent: (moduleId: string) => boolean;
  /** The ids the backend reported present, for callers that need the whole set. */
  presentIds: readonly string[];
}

/**
 * An unreachable backend must not blank the storefront, so a failed fetch
 * degrades to "everything is present" and each module's own fetch decides.
 * That is the opposite trade-off from the backend's gating seams, and
 * deliberately so: there, an unresolved axis means a refusal nobody sees; here,
 * it would mean an empty shop.
 */
const ALL_PRESENT: ModulePresenceSet = {
  isPresent: () => true,
  presentIds: [],
};

export async function getModulePresence(
  ctx: RequestContext = {},
): Promise<ModulePresenceSet> {
  try {
    const res = await apiGet<StorefrontModulePresenceResponse>(
      '/api/v1/storefront/module-presence',
      ctx,
      { revalidate: 300, tags: [MODULE_PRESENCE_TAG] },
    );
    const present = new Set(res.modules.filter((m) => m.present).map((m) => m.id));
    return {
      isPresent: (moduleId: string): boolean => present.has(moduleId),
      presentIds: [...present],
    };
  } catch {
    return ALL_PRESENT;
  }
}
