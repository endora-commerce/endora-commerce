'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Picks the site header based on the *current* route.
 *
 * The root layout is a Server Component and, in the Next.js App Router, it is
 * NOT re-executed on client-side ("soft") navigations — it renders once per
 * hard load and then persists. Deciding the header there from the request
 * pathname therefore "sticks": the minimal checkout header leaks onto pages
 * visited after checkout, and the full header that was rendered on a non-checkout
 * hard load stays in place after navigating into checkout.
 *
 * `usePathname()` re-renders this client component on every navigation (and
 * returns the correct value during SSR), so the header always matches the route.
 *
 * Both variants are passed as already-rendered Server Component trees; this
 * component only chooses which one to mount.
 */
export function HeaderSwitch({
  full,
  minimal,
}: {
  full: ReactNode;
  minimal: ReactNode;
}): ReactNode {
  const pathname = usePathname();
  const isCheckoutRoute = pathname?.startsWith('/checkout') ?? false;
  return <>{isCheckoutRoute ? minimal : full}</>;
}
