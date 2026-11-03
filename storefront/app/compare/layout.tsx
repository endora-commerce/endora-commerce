import type { ReactNode } from 'react';
import { requireModulePresent } from '../../lib/module-gate';

/**
 * The comparison pages, own and shared, belong to `comparisons`;
 * while it is off they answer not-found (issue #666).
 */
export default async function CompareLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('comparisons');
  return children;
}
