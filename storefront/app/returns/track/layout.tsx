import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * The guest's tracking page (`specs/181-guest-complaints/` FR-040 – FR-043) belongs to
 * `returns`: while it is off it answers the site's generic not-found (FR-080).
 *
 * The gate is here, one level above `[token]`, on purpose (design review F-6): a `notFound()`
 * thrown by a layout renders the **parent's** boundary, so module-off never shows the
 * token's neutral page (`[token]/not-found.tsx`) with its "contact the shop" line.
 */
export default async function TrackReturnsLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('returns');
  return <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:py-12">{children}</div>;
}
