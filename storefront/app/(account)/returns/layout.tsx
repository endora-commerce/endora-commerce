import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * The return pages belong to `returns`;
 * while it is off they answer not-found (issue #666).
 */
export default async function ReturnsLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('returns');
  return children;
}
