import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * The buyer's newsletter page belongs to `newsletter`;
 * while it is off it answers not-found (issue #666).
 */
export default async function AccountNewsletterLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('newsletter');
  return children;
}
