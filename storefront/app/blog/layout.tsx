import type { ReactNode } from 'react';

/**
 * Minimal blog-shell layout. The storefront's root layout already
 * provides the global header + footer; this shell adds inner padding
 * and a centered max-width column matching the Industria prototype's
 * editorial reading width.
 */
export default function BlogLayout({ children }: { children: ReactNode }): ReactNode {
  return <div className="mx-auto max-w-6xl px-4 py-12 lg:px-8">{children}</div>;
}
