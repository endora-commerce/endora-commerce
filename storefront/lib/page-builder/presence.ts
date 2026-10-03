import type { BlockPresence } from '@endora-commerce/page-builder-core/contributions';

import type { ModulePresenceSet } from '../api/module-presence';

/**
 * The module presence a Page Builder render boundary needs, in the form that
 * crosses from a Server Component into a `'use client'` one: the ids the
 * backend reports as **not present**.
 *
 * Absent is what the backend said, never what its list left out — an overlay
 * module's id is in no manifest index and is therefore not in the projection at
 * all, and its block must still render. When the projection could not be read,
 * `getModulePresence` degrades open and reports nobody absent, so every block
 * renders from its stored props.
 */
export function blockPresenceOf(modules: ModulePresenceSet): BlockPresence {
  return { absent: [...modules.absentIds].sort() };
}
