import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * The guest complaint pages (`specs/181-guest-complaints/` research R-13) belong to `returns`:
 * while it is off they answer not-found, as if never installed (FR-080, issue #666).
 *
 * Outside `(account)` on purpose: that group's layout and pages assume a session. The pages
 * here have no account panel around them, so the long ones (form, success) get the 720 px
 * column the account panel would have given them (design review, *Shared frame*).
 */
export default async function GuestReturnsLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('returns');
  return <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:py-12">{children}</div>;
}
