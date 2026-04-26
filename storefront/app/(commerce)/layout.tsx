import type { ReactNode } from 'react';

/**
 * Commerce route-group layout (T156–T158). Cart, checkout, and the
 * order-confirmation pages share the same chrome — a centred panel with
 * the rest of the storefront layout (header, footer) inherited from the
 * root layout.
 */
export default function CommerceLayout({ children }: { children: ReactNode }): ReactNode {
  return <div className="b2b-commerce">{children}</div>;
}
