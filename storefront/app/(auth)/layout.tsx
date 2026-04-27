import type { ReactNode } from 'react';

/**
 * Auth route-group layout (T150–T153). Anonymous flows: register, login,
 * email verification, password reset. The shell is intentionally minimal
 * so themes can replace it without affecting the form/server-action wiring.
 */
export default function AuthLayout({ children }: { children: ReactNode }): ReactNode {
  return <div className="b2b-auth-shell">{children}</div>;
}
