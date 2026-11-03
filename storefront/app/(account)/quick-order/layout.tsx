import type { ReactNode } from 'react';
import { requireModulePresent } from '../../../lib/module-gate';

/**
 * The quick-order page belongs to `quick_order`;
 * while it is off it answers not-found (issue #666).
 */
export default async function QuickOrderLayout({ children }: { children: ReactNode }): Promise<ReactNode> {
  await requireModulePresent('quick_order');
  return children;
}
